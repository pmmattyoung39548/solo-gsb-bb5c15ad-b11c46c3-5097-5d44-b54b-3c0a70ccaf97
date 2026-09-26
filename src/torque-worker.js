'use strict';

/**
 * /api/torque 带载计算线程（worker_threads）
 *
 * 完整速比枚举与级序载荷校核（planTorque）计算量大，放在主线程之外的
 * 独立计算线程中执行，主线程因此可以继续响应页面与其他 API。消息协议：
 *
 *   接收：{ id, gears, target: {num,den}, tolerance: {num,den}, inputTorque }
 *         （target / tolerance 的 num、den 与 inputTorque 均为 BigInt，
 *          worker_threads 的结构化克隆直接支持）
 *   回发：{ id, ok: true, plan } 或 { id, ok: false, error }
 *         （plan 内含 BigInt 分数，同样经结构化克隆传回；id 原样带回，
 *          主线程据此把结果交给对应请求，并发请求的结果不会串用）
 *
 * 每次只处理一个任务；任务内抛出的异常被捕获并回发为 ok: false，
 * 只有线程级崩溃（如内存耗尽）才会导致线程退出，由主线程重建。
 */

const { parentPort } = require('worker_threads');
const { planTorque } = require('./torque');

parentPort.on('message', (job) => {
  let plan;
  try {
    plan = planTorque(job.gears, job.target, job.tolerance, job.inputTorque);
  } catch (err) {
    parentPort.postMessage({
      id: job.id,
      ok: false,
      error: err && err.message ? err.message : String(err),
    });
    return;
  }
  parentPort.postMessage({ id: job.id, ok: true, plan });
});
