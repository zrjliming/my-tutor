#!/usr/bin/env bash
# 阶段 0：验证 whisper.cpp 命令行、模型下载、say 生成的 wav 能被识别。
set -euo pipefail

MODELS_DIR="$HOME/Library/Application Support/speakmate/models"
MODEL="$MODELS_DIR/ggml-small.en.bin"
WORK="$(mktemp -d)"

if ! command -v whisper-cli >/dev/null; then
  echo ">> 安装 whisper.cpp"
  brew install whisper.cpp
fi
echo ">> whisper-cli: $(command -v whisper-cli)"
whisper-cli --help 2>&1 | grep -E -- '-(oj|ojf|of|np|nt|l) ' || true

mkdir -p "$MODELS_DIR"
if [ ! -f "$MODEL" ]; then
  echo ">> 下载 ggml-small.en.bin（约 466 MB）"
  curl -L --progress-bar -o "$MODEL" \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
fi
ls -la "$MODEL"

echo ">> 用 say 合成一段英语并转成 16 kHz 单声道 wav"
say -v Samantha -o "$WORK/t.aiff" "I went to the airport yesterday and bought a ticket to Shanghai."
afconvert -f WAVE -d LEI16@16000 -c 1 "$WORK/t.aiff" "$WORK/t.wav"
afinfo "$WORK/t.wav" | grep -E 'Data format|estimated duration'

echo ">> 识别（耗时见下）"
START=$(date +%s.%N)
whisper-cli -m "$MODEL" -f "$WORK/t.wav" -l en -ojf -of "$WORK/t" -np
END=$(date +%s.%N)
echo ">> 耗时 $(echo "$END - $START" | bc) 秒"
echo ">> JSON 输出（前 60 行）"
head -60 "$WORK/t.json"
echo ">> 文本："
python3 -I -c "import json,sys; d=json.load(open(sys.argv[1])); print(''.join(s['text'] for s in d['transcription']).strip()); print('segments:', len(d['transcription'])); t=[tok for s in d['transcription'] for tok in s.get('tokens',[])]; print('tokens with p:', len(t), 'mean p:', round(sum(x['p'] for x in t)/len(t),3) if t else None)" "$WORK/t.json"
echo ">> 临时目录 ${WORK}（看完可删）"
