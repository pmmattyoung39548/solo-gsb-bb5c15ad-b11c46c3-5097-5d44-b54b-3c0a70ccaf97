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
 *   - 请求方取消任务（HTTP 连接中断：页面重新提交 / 离开页面等）时：
 *       排队中的任务立即移出 FIFO 并释放名额（不再占两席等待容量）；
 *       正在计算的任务立即终止其计算线程（worker.terminate），随后按需
 *       重建线程并继续按顺序处理队列中剩余的请求；
 *   - 计算线程异常退出时，仅当前执行的请求失败，随后自动重建线程、
 *     继续按顺序处理队列中剩余的请求；
 *   - 每个任务带单调递增 id，响应按 id 与当前任务匹配后才交付；
 *     被终止旧线程迟到的消息与退出事件按 worker 身份识别后一律忽略，
 *     并发 / 取消请求的结果不会串用，也不会影响新任务。
 */

const path = require('path');
const { Worker } = require('worker_threads');

/** 最多允许排队等待的请求数（不含正在执行的 1 个） */
const MAX_WAITING = 2;

/** 任务被请求方取消（HTTP 连接关闭）时用于拒绝结果 Promise 的错误 */
class TaskCanceledError extends Error {
  constructor(message = '带载计算已取消') {
    super(message);
    this.name = 'TaskCanceledError';
    /** 路由据此识别“主动取消”，不再向已关闭的连接写响应 */
    this.canceled = true;
  }
}

class TorqueComputeQueue {
  /**
   * @param {{workerPath?: string, maxWaiting?: number}} [opts]
   *        workerPath 供测试替换计算线程入口；maxWaiting 供测试缩小队列
   */
  constructor(opts = {}) {
    // TORQUE_WORKER_PATH 仅供测试替换计算线程入口，生产环境不设置时走默认 worker
    this.workerPath =
      opts.workerPath || process.env.TORQUE_WORKER_PATH || path.join(__dirname, 'torque-worker.js');
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
   *   accepted 时附带 cancel()，连接中断由调用方触发以释放队列名额 /
   *   终止正在执行的计算线程。
   */
  submit(payload) {
    if (this.waiting.length >= this.maxWaiting) return { accepted: false };
    const task = { id: this.nextId++, payload, settled: false };
    task.result = new Promise((resolve, reject) => {
      task.resolve = resolve;
      task.reject = reject;
    });
    const handle = {
      accepted: true,
      result: task.result,
      cancel: () => this._cancel(task),
    };
    this.waiting.push(task);
    this._pump();
    return handle;
  }

  /**
   * 取消任务：
   *   - 排队等待中：立即移出 FIFO 并释放名额（无需触碰计算线程）；
   *   - 正在计算：终止对应 worker 释放 CPU，随后重建线程继续 FIFO；
   *   - 已交付 / 已失败 / 已取消：空操作（幂等）。
   * @param {{id:number}} task
   */
  _cancel(task) {
    if (task.settled) return;

    const waitingIndex = this.waiting.indexOf(task);
    if (waitingIndex !== -1) {
      // 等待任务立即出队，名额同步释放，后续有效请求不会再被误判满员
      this.waiting.splice(waitingIndex, 1);
      this._rejectCanceled(task);
      return;
    }

    if (this.current === task) {
      this.current = null;
      this._rejectCanceled(task);
      // 终止正在执行该任务的计算线程；旧线程随后迟到的 message / exit
      // 因 worker 身份不再匹配而被忽略，不会影响重建后的新任务
      this._terminateWorker();
      // 队列中还有等待任务时立即重建线程并继续；否则下次提交时按需重建
      this._pump();
    }
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
      if (code !== 0) this._onCrash(worker, new Error(`计算线程异常退出（退出码 ${code}）`));
    });
    this.worker = worker;
  }

  /** 终止当前计算线程并解除引用（退出事件由身份校验忽略，不触发崩溃重建流程） */
  _terminateWorker() {
    const worker = this.worker;
    if (!worker) return;
    this.worker = null;
    // terminate() 在底层强制结束线程，返回的 Promise 仅在极端情况下拒绝，
    // 这里没有后续动作需要等待，吞掉拒绝即可；exit 回调仍会触发但被忽略
    worker.terminate().catch(() => {});
  }

  _rejectCanceled(task) {
    task.settled = true;
    task.reject(new TaskCanceledError());
  }

  _onMessage(worker, msg) {
    if (worker !== this.worker) return; // 已终止 / 已重建旧线程迟到的消息，忽略
    const task = this.current;
    if (!task || !msg || msg.id !== task.id) return; // 只交付当前任务的响应，结果不串用
    if (task.settled) return; // 双保险：取消与交付并发时只生效一次
    this.current = null;
    task.settled = true;
    if (msg.ok) task.resolve(msg.plan);
    else task.reject(new Error(msg.error || '带载计算失败'));
    this._pump();
  }

  /** 线程崩溃：仅让当前任务失败，重建线程后继续按顺序处理队列 */
  _onCrash(worker, err) {
    if (worker !== this.worker) return; // error / exit 只处理先到的那个；被终止的旧线程也在此忽略
    this.worker = null;
    const task = this.current;
    this.current = null;
    if (task && !task.settled) {
      task.settled = true;
      task.reject(err instanceof Error ? err : new Error(String(err)));
    }
    // 队列中还有等待任务时立即重建线程并继续；否则下次提交时按需重建
    this._pump();
  }
}

module.exports = { TorqueComputeQueue, MAX_WAITING, TaskCanceledError };
