# Chelo dual-NNUE training

`train_nnue.py` is the PyTorch/AdamW QAT trainer retained from the Stage 3.7 architecture work. It exports the C36N binary format parsed by `src/nnue/dual-nnue.js`.

Example from the repository root (Kaggle CUDA or a local CUDA host):

```sh
python training/train_nnue.py \
  --data /kaggle/input/your-labelled-positions/positions.jsonl \
  --checkpoint models/base-v14-float32.json \
  --out models/dual-nnue-next.bin \
  --device cuda
```

Input rows are JSONL objects with `fen`, `value` (teacher millivalue), and `wdl` (`[win, draw, loss]`). The trainer writes a `.manifest.json` and `.sha256` beside the output binary. Do not overwrite the pinned `models/dual-nnue-v37.bin` during experiments.

The V14 checkpoint metadata records that its WDL head was not trained on puzzle targets. Distillation from that teacher is a bootstrap/compatibility process, not outcome-labelled strength training. For real strength training, supply reliable game-outcome WDL labels and preserve dataset provenance.

Training-only dependencies are PyTorch and NumPy. The browser runtime has no Python dependency and no external CDN dependency.
