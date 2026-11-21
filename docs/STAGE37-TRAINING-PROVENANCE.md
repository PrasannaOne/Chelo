# Stage 3.7 NNUE artifact provenance

Uploaded artifact: `dual-nnue-v37.bin`

The uploader describes the artifact as trained on a Kaggle T4 GPU using 5,000,000 Stockfish depth-18+ positions sourced from Lichess / `chess-position-evaluations`, with blended evaluation + WDL loss and quantization-aware training.

The binary itself verifies as a valid Chelo C36N v1 model with the expected `(768 -> 32) x 2 -> 64 -> 1` layout and 49,368-byte payload. Its SHA-256 is:

`f9ffe3f0dc641c93be26f871086182a82291411a4e4b59c073fcc7c8bfc4022e`

**Provenance limitation:** the binary does not contain the dataset manifest, source-position IDs, train/validation split hashes, Stockfish build/version, search settings, teacher scores/WDL labels, training log, optimizer state, QAT calibration report, or reproducible checkpoint/export package. Therefore the Kaggle T4 / 5-million-position / depth-18+ description is recorded as uploader-supplied metadata, not an independently verified fact.

The paired gauntlets in `benchmarks/results/` independently measure playing strength of the submitted weights in this repository's Node.js worker harness. They do not prove dataset provenance, absolute FIDE/CCRL/Stockfish Elo, or a 3,050+ rating.
