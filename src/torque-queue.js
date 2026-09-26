'use strict';

/**
 * /api/torque 带载计算调度器（主线程侧）
 *
 * 把完整速比枚举与级序载荷校核（planTorque）交给唯一的 worker_threads
 * 计算线程执行，主线程继续响应页面与其他 API：
 *
 *   - 计算请求按到达顺序（FIFO）逐个执行，同一时刻只有 1 个在算；
 *   - 最多允许 MAX_WAITING 个请求排队等待，队列已满时新请求立即被拒绝
 *     （submit 返回 accepted: false，路由据此回复 503）；
 *   - 计算线程异常退出时，仅当前执行的请求失败，随后自动重建线程、
 *     继续按顺序处理队列中剩余的请求；
 *   - 每个任务带单调递增 id，响应按 id 与当前任务匹配后才交付，
 *     并发请求的结果不会串用；
 *   - 请求方在拿到结果前放弃任务（HTTP 连接关闭 / 新提交顶替旧提交）时
 *     调用返回句柄的 cancel：
 *       · 仍在排队：立即移出 FIFO 并释放名额，其 result 以
 *         TaskCancelled 结束（调用方应静默丢弃，不回复已关闭的连接）；
 *       · 正在计算：立即终止（terminate）当前 worker 并重建线程，
 *         随后继续按顺序处理 FIFO 中剩余任务；被终止 worker 迟到的
 *         消息与 exit 事件一律忽略，绝不影响重建后的新任务。
 */

const path = require('path');
const { Worker } = require('worker_threads');

/** 最多允许排队等待的请求数（不含正在执行的 1 个） */
const MAX_WAITING = 2;

/** 任务因请求方放弃（连接关闭 / 被新提交顶替）而被取消 */
class TaskCancelled extends Error {
  constructor(message = '带载计算任务已取消') {
    super(message);
    this.name = 'TaskCancelled';
  }
}

class TorqueComputeQueue {
  /**
   * @param {{workerPath?: string, maxWaiting?: number}} [opts]
   *        workerPath 供测试替换计算线程入口；maxWaiting 供测试缩小队列
   */
  constructor(opts = {}) {
    this.workerPath = opts.workerPath || path.join(__dirname, 'torque-worker.js');
    this.maxWaiting = opts.maxWaiting ?? MAX_WAITING;
    /** @type {Worker|null} */
    this.worker = null;
    /** 正在计算线程中执行的任务（同一时刻至多 1 个） */
    this.current = null;
    /** 按到达顺序排队等待的任务 */
    this.waiting = [];
    this.nextId = 1;
  }

  /** 排队等待中的请求数（用于 503 提示与测试观测） */
  get waitingCount() {
    return this.waiting.length;
  }

  /** 是否已有任务在计算线程中执行 */
  get busy() {
    return this.current !== null;
  }

  /**
   * 提交一次带载计算。
   * @param {{gears:Array,target:object,tolerance:object,inputTorque:bigint}} payload
   * @returns {{accepted:true,result:Promise<object>,cancel:()=>void}|{accepted:false}}
   *   队列已满时返回 { accepted: false }，调用方应立即回复 503；
   *   否则返回 result（计算结果 Promise）与 cancel（请求方放弃时调用，幂等）。
   */
  submit(payload) {
    if (this.waiting.length >= this.maxWaiting) return { accepted: false };
    const task = { id: this.nextId++, payload, settled: false };
    const result = new Promise((resolve, reject) => {
      task.resolve = resolve;
      task.reject = reject;
    });
    // 取消后 result 必然 reject，避免未处理拒绝造成进程告警
    result.catch(() => {});
    this.waiting.push(task);
    this._pump();
    return { accepted: true, result, cancel: () => this._cancel(task) };
  }

  /** 线程空闲且队列非空时，把队首任务发给计算线程 */
  _pump() {
    if (this.current || this.waiting.length === 0) return;
    if (!this.worker) this._spawn();
    const task = this.waiting.shift();
    this.current = task;
    this.worker.postMessage({ id: task.id, ...task.payload });
  }

  _spawn() {
    const worker = new Worker(this.workerPath);
    worker.on('message', (msg) => this._onMessage(worker, msg));
    // 线程内未捕获异常先触发 error、随后必跟随非零 exit，二者共用同一处理（幂等）；
    // 任何非零退出都视为崩溃，仅让当前任务失败并重建线程
    worker.on('error', (err) => this._onCrash(worker, err));
    worker.on('exit', (code) => {
      if (worker === this.worker && code !== 0) {
        this._onCrash(worker, new Error(`计算线程异常退出（退出码 ${code}）`));
      }
    });
    this.worker = worker;
  }

  /** 结算当前任务（resolve/reject 各只允许一次），随后推进 FIFO */
  _finishCurrent(worker, settle) {
    const task = this.current;
    if (!task || task.settled) return;
    task.settled = true;
    this.current = null;
    settle(task);
    // 崩溃路径已把 worker 置空并可能完成重建；消息路径的 worker 仍可复用
    if (!worker) this.worker = null;
    this._pump();
  }

  _onMessage(worker, msg) {
    if (worker !== this.worker) return; // 已终止 / 已重建的旧线程迟到的消息，忽略
    if (!this.current || !msg || msg.id !== this.current.id) return; // 结果对号，不串用
    this._finishCurrent(worker, (task) => {
      if (msg.ok) task.resolve(msg.plan);
      else task.reject(new Error(msg.error || '带载计算失败'));
    });
  }

  /** 线程崩溃：仅让当前任务失败，重建线程后继续按顺序处理队列 */
  _onCrash(worker, err) {
    if (worker !== this.worker) return; // 旧线程迟到的 error / exit，忽略
    const error = err instanceof Error ? err : new Error(String(err));
    this.worker = null;
    this._finishCurrent(null, (task) => task.reject(error));
  }

  /**
   * 放弃一个已提交任务（幂等；已结算或已出队的取消调用为空操作）。
   * - 排队中：立即移出 FIFO、释放名额；
   * - 计算中：终止 worker 并重建线程，随后继续 FIFO。
   */
  _cancel(task) {
    if (task.settled) return;

    const waitingIndex = this.waiting.indexOf(task);
    if (waitingIndex !== -1) {
      // 等待任务立即移出 FIFO 并释放名额，避免占坑导致有效请求误收 503
      this.waiting.splice(waitingIndex, 1);
      task.settled = true;
      task.reject(new TaskCancelled());
      return;
    }

    if (this.current !== task) return; // 不属于本队列（理论上不可达），忽略

    // 正在计算：终止对应 worker（其迟到消息 / exit 因 worker !== this.worker
    // 全部被忽略），重建线程后继续处理 FIFO 中剩余任务
    const oldWorker = this.worker;
    this.worker = null;
    task.settled = true;
    task.reject(new TaskCancelled());
    this.current = null;
    if (oldWorker) {
      oldWorker.terminate().catch(() => {});
    }
    this._pump();
  }
}

module.exports = { TorqueComputeQueue, MAX_WAITING, TaskCancelled };
