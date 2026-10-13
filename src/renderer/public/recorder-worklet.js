// 把输入第 0 声道的 Float32 样本按块发回主线程；不做任何处理。
class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0]
    if (channel && channel.length > 0) {
      this.port.postMessage(channel.slice(0))
    }
    return true
  }
}
registerProcessor('recorder-processor', RecorderProcessor)
