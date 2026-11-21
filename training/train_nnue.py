#!/usr/bin/env python3
"""Chelo Stage 3.7 dual-perspective NNUE distillation/QAT trainer.

Input JSONL rows: {fen, value, wdl:[win,draw,loss], id?}. `value` is the
V14 evaluator's millivalue. This script supports Kaggle CUDA and CPU fallback.
The resulting .bin is the exact little-endian format parsed by dual-nnue.js.
"""
from __future__ import annotations
import argparse, hashlib, json, math, os, random, struct, time
from pathlib import Path
from typing import Iterable

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

FEATURES, HIDDEN, OUTPUT_DIVISOR = 768, 32, 1 << 20
MAGIC = b'C36N'
VERSION = 1
HEADER = struct.Struct('<4sHHHHII')  # magic, version, features, hidden, flags, out_divisor, reserved

PIECE = {'p': 0, 'n': 1, 'b': 2, 'r': 3, 'q': 4, 'k': 5}

def parse_fen_features(fen: str) -> tuple[np.ndarray, np.ndarray]:
    board = fen.split()[0].split('/')
    if len(board) != 8:
        raise ValueError(f'invalid FEN board field: {fen}')
    white = np.full(64, FEATURES, dtype=np.int64)  # padding index
    black = np.full(64, FEATURES, dtype=np.int64)
    for rank, row in enumerate(board):
        file = 0
        for ch in row:
            if ch.isdigit():
                file += int(ch)
                continue
            if ch.lower() not in PIECE or file >= 8:
                raise ValueError(f'invalid FEN piece placement: {fen}')
            typ = PIECE[ch.lower()]
            is_white = ch.isupper()
            sq = rank * 8 + file
            w_code = typ if is_white else typ + 6
            b_code = typ if not is_white else typ + 6
            white[sq] = sq * 12 + w_code
            # Black perspective: vertical rank flip only, with color swap.
            b_sq = (7 - rank) * 8 + file
            black[b_sq] = b_sq * 12 + b_code
            file += 1
        if file != 8:
            raise ValueError(f'invalid FEN rank width: {fen}')
    return white, black

def ste_round_clamp(x: torch.Tensor, low: int, high: int) -> torch.Tensor:
    q = torch.clamp(torch.round(x), low, high)
    return x + (q - x).detach()

class DualNNUE(nn.Module):
    def __init__(self, teacher: dict, seed: int = 20261120):
        super().__init__()
        torch.manual_seed(seed)
        tensors = teacher['tensors']
        old_w = np.asarray(tensors['w1'], dtype=np.float32).reshape(784, 48)
        old_b = np.asarray(tensors['b1'], dtype=np.float32)
        # Warm-start from V14's feature transformer, retaining 32 channels.
        ww = np.rint(old_w[:FEATURES, :HIDDEN] * 64.0).clip(-127, 127).astype(np.float32)
        # V14 Black perspective used a 180-degree square rotation. Re-map its
        # file axis so Stage 3.6 uses the requested vertical rank flip only.
        wb = np.zeros_like(ww)
        for sq in range(64):
            wb[sq * 12:(sq + 1) * 12] = ww[(sq ^ 7) * 12:((sq ^ 7) + 1) * 12]
        self.w_white = nn.Parameter(torch.from_numpy(ww.copy()))
        self.w_black = nn.Parameter(torch.from_numpy(wb.copy()))
        bb = np.rint(old_b[:HIDDEN] * 64.0).clip(-32768, 32767).astype(np.float32)
        self.b_white = nn.Parameter(torch.from_numpy(bb.copy()))
        self.b_black = nn.Parameter(torch.from_numpy(bb.copy()))
        self.out = nn.Parameter(torch.randn(64) * 0.5)
        self.out_bias = nn.Parameter(torch.tensor(0.0))

    def forward(self, idx_w: torch.Tensor, idx_b: torch.Tensor, stm_black: torch.Tensor):
        # Keep the module interface identical to the exported inference path.
        score, _, _ = forward_score(self, idx_w, idx_b, stm_black)
        return score

    def score_from_activations(self, activations: torch.Tensor):
        out_q = ste_round_clamp(self.out, -127, 127)
        bias_q = self.out_bias * OUTPUT_DIVISOR
        bias_ste = bias_q + (torch.round(bias_q) - bias_q).detach()
        return (activations @ out_q + bias_ste) / OUTPUT_DIVISOR


def load_rows(path: Path):
    rows = []
    for line_no, line in enumerate(path.open('r', encoding='utf8'), 1):
        if not line.strip():
            continue
        row = json.loads(line)
        iw, ib = parse_fen_features(row['fen'])
        wdl = row.get('wdl', [0.3333, 0.3334, 0.3333])
        if len(wdl) != 3:
            raise ValueError(f'line {line_no}: WDL must contain [win,draw,loss]')
        stm_black = row['fen'].split()[1] == 'b'
        rows.append((iw, ib, float(row.get('value', 0.0)) / 1000.0,
                     float(wdl[0]), float(wdl[1]), float(wdl[2]), stm_black,
                     str(row.get('id', line_no))))
    if len(rows) < 100:
        raise ValueError('Need at least 100 valid teacher positions for distillation.')
    return rows

def split_rows(rows):
    train, valid = [], []
    for row in rows:
        key = hashlib.sha1((row[7] + '|' + str(row[0][:8].tolist())).encode()).digest()[0]
        (valid if key < 26 else train).append(row)
    return train, valid

def batch_tensors(rows, indices, device):
    batch = [rows[int(i)] for i in indices]
    iw = torch.from_numpy(np.stack([x[0] for x in batch])).to(device=device, dtype=torch.long)
    ib = torch.from_numpy(np.stack([x[1] for x in batch])).to(device=device, dtype=torch.long)
    values = torch.tensor([x[2] for x in batch], device=device, dtype=torch.float32)
    wdl = torch.tensor([[x[3], x[4], x[5]] for x in batch], device=device, dtype=torch.float32)
    stm_black = torch.tensor([x[6] for x in batch], device=device, dtype=torch.bool)
    return iw, ib, values, wdl, stm_black

def forward_score(model, iw, ib, stm_black):
    ww = ste_round_clamp(model.w_white, -127, 127)
    wb = ste_round_clamp(model.w_black, -127, 127)
    bw = ste_round_clamp(model.b_white, -32768, 32767)
    bb = ste_round_clamp(model.b_black, -32768, 32767)
    ew = torch.cat((ww, torch.zeros((1, HIDDEN), device=ww.device)), dim=0)
    eb = torch.cat((wb, torch.zeros((1, HIDDEN), device=wb.device)), dim=0)
    aw = F.embedding(iw, ew).sum(dim=1) + bw
    ab = F.embedding(ib, eb).sum(dim=1) + bb
    hw = torch.clamp(aw, 0, 255).square()
    hb = torch.clamp(ab, 0, 255).square()
    stm = torch.where(stm_black[:, None], hb, hw)
    nstm = torch.where(stm_black[:, None], hw, hb)
    activations = torch.cat((stm, nstm), dim=1)
    return model.score_from_activations(activations), aw, ab

def write_binary(model: DualNNUE, out_path: Path):
    def q8(x): return torch.clamp(torch.round(x), -127, 127).to(torch.int8).cpu().numpy().astype(np.int8)
    def q16(x): return torch.clamp(torch.round(x), -32768, 32767).to(torch.int16).cpu().numpy().astype('<i2')
    def qi32(x): return np.asarray([int(torch.clamp(torch.round(x * OUTPUT_DIVISOR), -2147483648, 2147483647).item())], dtype='<i4')
    arrays = [q8(model.w_white).tobytes(order='C'), q8(model.w_black).tobytes(order='C'),
              q16(model.b_white).tobytes(order='C'), q16(model.b_black).tobytes(order='C'),
              q8(model.out).tobytes(order='C'), qi32(model.out_bias).tobytes()]
    header = HEADER.pack(MAGIC, VERSION, FEATURES, HIDDEN, 1, OUTPUT_DIVISOR, 0)
    payload = header + b''.join(arrays)
    if len(payload) >= 50000:
        raise AssertionError(f'quantized network exceeds the 50,000-byte cap: {len(payload)}')
    out_path.write_bytes(payload)
    return len(payload)

def main():
    p = argparse.ArgumentParser()
    p.add_argument('--data', type=Path, required=True, help='V14 teacher JSONL: fen,value,wdl')
    p.add_argument('--checkpoint', type=Path, required=True, help='models/base-v14-float32.json')
    p.add_argument('--out', type=Path, default=Path('models/dual-nnue-next.bin'))
    p.add_argument('--epochs', type=int, default=12)
    p.add_argument('--batch-size', type=int, default=512)
    p.add_argument('--lr', type=float, default=0.003)
    p.add_argument('--seed', type=int, default=20261120)
    p.add_argument('--max-positions', type=int, default=0, help='optional deterministic bootstrap subset; 0 uses all rows')
    p.add_argument('--device', default='auto', choices=['auto', 'cpu', 'cuda'])
    args = p.parse_args()
    random.seed(args.seed); np.random.seed(args.seed); torch.manual_seed(args.seed); torch.set_num_threads(max(1, min(8, os.cpu_count() or 1)))
    device = torch.device('cuda' if (args.device == 'cuda' or (args.device == 'auto' and torch.cuda.is_available())) else 'cpu')
    checkpoint = json.loads(args.checkpoint.read_text())
    if checkpoint.get('version') != 14 or 'tensors' not in checkpoint:
        raise ValueError('Expected the frozen V14 Float32 checkpoint.')
    rows = load_rows(args.data)
    if args.max_positions and len(rows) > args.max_positions:
        random.shuffle(rows); rows = rows[:args.max_positions]
    train_rows, valid_rows = split_rows(rows)
    model = DualNNUE(checkpoint).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-5)
    history = []
    started = time.time()
    for epoch in range(args.epochs):
        random.shuffle(train_rows)
        model.train(); losses=[]
        order = np.arange(len(train_rows))
        for start in range(0, len(order), args.batch_size):
            idx = order[start:start+args.batch_size]
            iw, ib, target, wdl, stm_black = batch_tensors(train_rows, idx, device)
            pred, aw, ab = forward_score(model, iw, ib, stm_black)
            eval_loss = F.smooth_l1_loss(pred, target)
            teacher_expected = wdl[:, 0] + 0.5 * wdl[:, 1]
            predicted_expected = torch.sigmoid(pred * 8.0)
            wdl_loss = F.mse_loss(predicted_expected, teacher_expected)
            # Keep int16 pre-activations comfortably away from wraparound.
            range_penalty = (F.relu(torch.abs(aw)-30000).square().mean() + F.relu(torch.abs(ab)-30000).square().mean()) * 1e-8
            loss = 0.65 * eval_loss + 0.35 * wdl_loss + range_penalty
            optimizer.zero_grad(set_to_none=True); loss.backward(); torch.nn.utils.clip_grad_norm_(model.parameters(), 2.0); optimizer.step()
            losses.append(float(loss.detach().cpu()))
        model.eval(); val_losses=[]; mae=[]
        with torch.no_grad():
            for start in range(0, len(valid_rows), args.batch_size):
                idx=np.arange(start,min(start+args.batch_size,len(valid_rows)))
                iw,ib,target,wdl,stm_black=batch_tensors(valid_rows,idx,device)
                pred,_,_=forward_score(model,iw,ib,stm_black)
                val_losses.append(float((0.65*F.smooth_l1_loss(pred,target)+0.35*F.mse_loss(torch.sigmoid(pred*8.0),wdl[:,0]+0.5*wdl[:,1])).cpu()))
                mae.append(float(torch.abs(pred-target).mean().cpu()))
        row={'epoch':epoch+1,'train_loss':float(np.mean(losses)),'validation_loss':float(np.mean(val_losses)),'validation_mae':float(np.mean(mae))}
        history.append(row); print(json.dumps(row), flush=True)
    size = write_binary(model, args.out)
    digest = hashlib.sha256(args.out.read_bytes()).hexdigest()
    manifest = {
        'format':'Chelo Stage 3.7 Dual-Perspective NNUE', 'version':VERSION,
        'architecture':'(768 -> 32) x 2 -> side-to-move concatenation -> SCReLU -> 64 -> 1',
        'features':FEATURES, 'hiddenPerPerspective':HIDDEN, 'activation':'clamp(x,0,255)^2',
        'blackPerspective':'vertical rank flip + color swap', 'accumulator':'Int16Array(32) per perspective, MAX_PLY=128',
        'quantization':{'transformer':'Int8','bias':'Int16','output':'Int8','outputBias':'Int32','outputDivisor':OUTPUT_DIVISOR},
        'binaryBytes':size,'binarySha256':digest,'sourcePositions':len(rows),
        'trainPositions':len(train_rows),'validationPositions':len(valid_rows),
        'teacher':'frozen V14 evaluator; WDL/eval blend distillation',
        'teacherWDLWarning':'V14 checkpoint metadata states WDL head was not trained on puzzle targets; distillation is compatibility/bootstrap only, not a strength claim.',
        'device':str(device),'epochs':args.epochs,'seconds':round(time.time()-started,3),'history':history
    }
    manifest_path=args.out.with_suffix('.manifest.json');manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
    sha_path=args.out.with_suffix('.sha256');sha_path.write_text(f'{digest}  {args.out.name}\n')
    print(json.dumps({'binary':str(args.out),'binaryBytes':size,'sha256':digest,'manifest':str(manifest_path),'device':str(device),'seconds':round(time.time()-started,3)},indent=2))

if __name__ == '__main__': main()
