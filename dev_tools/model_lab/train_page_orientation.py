"""Train and export M7 4-way page orientation classifier (0/90/180/270 CW) to ONNX."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import onnx
import onnxruntime as ort
import torch
import torch.nn as nn
from PIL import Image, ImageEnhance, ImageFilter, ImageOps
from torch.utils.data import DataLoader, Dataset
from torchvision import models

ORIENTATION_CLASSES = (0, 90, 180, 270)
INPUT_SIZE = 224
DEFAULT_VAL_GROUPS = ("yunchan", "scan", "one")
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train M7 manga storyboard orientation ONNX classifier")
    parser.add_argument("--data-dir", type=Path, required=True, help="Root folder containing grouped upright pages")
    parser.add_argument("--output-dir", type=Path, required=True, help="Output directory for model.onnx and metrics")
    parser.add_argument("--epochs", type=int, default=25)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--lr", type=float, default=6e-4)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--repeats", type=int, default=4, help="Augmented passes per base orientation sample per epoch")
    return parser.parse_args()


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


def discover_pages(data_dir: Path) -> list[tuple[str, Path]]:
    exts = {".jpg", ".jpeg", ".png", ".webp"}
    pages: list[tuple[str, Path]] = []
    for path in sorted(data_dir.rglob("*")):
        if path.is_file() and path.suffix.lower() in exts and not path.name.startswith("."):
            rel = path.relative_to(data_dir)
            group = rel.parts[0] if len(rel.parts) > 1 else "misc"
            pages.append((group, path))
    if not pages:
        raise FileNotFoundError(f"No images found under {data_dir}")
    return pages


def rotate_for_target(upright: Image.Image, target_cw_degrees: int) -> Image.Image:
    """Apply the inverse rotation so returning upright needs target_cw_degrees clockwise."""
    if target_cw_degrees == 0:
        return upright.copy()
    if target_cw_degrees == 90:
        return upright.rotate(90, expand=True)
    if target_cw_degrees == 180:
        return upright.rotate(180, expand=True)
    if target_cw_degrees == 270:
        return upright.rotate(-90, expand=True)
    raise ValueError(f"Unsupported degree: {target_cw_degrees}")


def augment_page_image(image: Image.Image, rng: random.Random) -> Image.Image:
    """Domain augmentation for manga storyboards without ever flipping left/right or top/bottom."""
    w, h = image.size
    # Optional slight crop (keep >= 84%) and/or aspect ratio jitter before resize
    if rng.random() < 0.8:
        crop_scale = rng.uniform(0.84, 1.0)
        cw = max(32, int(w * crop_scale))
        ch = max(32, int(h * crop_scale))
        left = rng.randint(0, max(0, w - cw))
        top = rng.randint(0, max(0, h - ch))
        image = image.crop((left, top, left + cw, top + ch))

    if rng.random() < 0.55:
        aspect_mul = rng.uniform(0.86, 1.16)
        nw = max(32, int(image.width * aspect_mul))
        nh = max(32, image.height)
        image = image.resize((nw, nh), Image.Resampling.BILINEAR)

    if rng.random() < 0.75:
        small_angle = rng.uniform(-6.0, 6.0)
        image = image.rotate(small_angle, resample=Image.Resampling.BILINEAR, expand=False, fillcolor=(255, 255, 255))

    if rng.random() < 0.35:
        image = ImageOps.grayscale(image).convert("RGB")
    if rng.random() < 0.75:
        image = ImageEnhance.Brightness(image).enhance(rng.uniform(0.82, 1.18))
    if rng.random() < 0.75:
        image = ImageEnhance.Contrast(image).enhance(rng.uniform(0.75, 1.35))
    if rng.random() < 0.25:
        image = image.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.3, 1.1)))
    if rng.random() < 0.25:
        buf = io.BytesIO()
        image.save(buf, format="JPEG", quality=rng.randint(55, 92))
        buf.seek(0)
        image = Image.open(buf).convert("RGB")
    return image


def image_to_tensor(image: Image.Image) -> torch.Tensor:
    resized = image.resize((INPUT_SIZE, INPUT_SIZE), Image.Resampling.BILINEAR)
    arr = np.asarray(resized, dtype=np.float32) / 255.0
    return torch.from_numpy(arr.transpose(2, 0, 1))


class OrientationDataset(Dataset):
    def __init__(self, page_paths: list[Path], *, augment: bool, repeats: int = 1, seed: int = 42):
        self.base_images: list[Image.Image] = []
        for path in page_paths:
            with Image.open(path) as src:
                self.base_images.append(ImageOps.exif_transpose(src).convert("RGB"))
        self.augment = augment
        self.repeats = max(1, repeats)
        self.seed = seed

    def __len__(self) -> int:
        return len(self.base_images) * len(ORIENTATION_CLASSES) * self.repeats

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, int]:
        num_orient = len(ORIENTATION_CLASSES)
        page_idx = (idx // num_orient) % len(self.base_images)
        label = idx % num_orient
        img = rotate_for_target(self.base_images[page_idx], ORIENTATION_CLASSES[label])
        if self.augment:
            rng = random.Random(idx * 1000003 + self.seed + random.randint(0, 999999))
            img = augment_page_image(img, rng)
        return image_to_tensor(img), label


class OrientationModelWrapper(nn.Module):
    """Wraps MobileNetV3 with built-in [0, 1] -> ImageNet normalization for seamless ONNX export."""

    def __init__(self, arch: str, num_classes: int = 4, dropout: float = 0.2):
        super().__init__()
        if arch == "mobilenet_v3_small":
            backbone = models.mobilenet_v3_small(weights=models.MobileNet_V3_Small_Weights.DEFAULT)
        elif arch == "mobilenet_v3_large":
            backbone = models.mobilenet_v3_large(weights=models.MobileNet_V3_Large_Weights.DEFAULT)
        else:
            raise ValueError(f"Unsupported arch: {arch}")
        in_features = backbone.classifier[-1].in_features
        backbone.classifier[-1] = nn.Linear(in_features, num_classes)
        if hasattr(backbone.classifier[-2], "p"):
            backbone.classifier[-2].p = dropout
        self.backbone = backbone
        mean = torch.tensor(IMAGENET_MEAN, dtype=torch.float32).view(1, 3, 1, 1)
        std = torch.tensor(IMAGENET_STD, dtype=torch.float32).view(1, 3, 1, 1)
        self.register_buffer("mean", mean)
        self.register_buffer("std", std)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        normalized = (x - self.mean) / self.std
        return self.backbone(normalized)


def evaluate_model(model: nn.Module, loader: DataLoader, device: torch.device) -> dict[str, Any]:
    model.eval()
    correct = 0
    total = 0
    per_class_correct = [0, 0, 0, 0]
    per_class_total = [0, 0, 0, 0]
    confidences: list[float] = []
    confusion = [[0] * 4 for _ in range(4)]
    with torch.no_grad():
        for xb, yb in loader:
            xb = xb.to(device)
            logits = model(xb)
            probs = torch.softmax(logits, dim=1).cpu()
            preds = probs.argmax(dim=1)
            for pred, target, prob_vec in zip(preds.tolist(), yb.tolist(), probs.tolist()):
                total += 1
                per_class_total[target] += 1
                confusion[target][pred] += 1
                if pred == target:
                    correct += 1
                    per_class_correct[target] += 1
                confidences.append(prob_vec[pred])
    acc = correct / max(1, total)
    per_class_acc = {
        str(ORIENTATION_CLASSES[i]): round(per_class_correct[i] / max(1, per_class_total[i]), 4)
        for i in range(4)
    }
    return {
        "accuracy": round(acc, 4),
        "correct": correct,
        "total": total,
        "per_class_accuracy": per_class_acc,
        "mean_pred_confidence": round(sum(confidences) / max(1, len(confidences)), 4),
        "confusion_matrix": confusion,
    }


def train_one_run(
    arch: str,
    train_paths: list[Path],
    val_paths: list[Path] | None,
    *,
    epochs: int,
    batch_size: int,
    lr: float,
    repeats: int,
    seed: int,
    device: torch.device,
) -> tuple[nn.Module, dict[str, Any]]:
    set_seed(seed)
    train_ds = OrientationDataset(train_paths, augment=True, repeats=repeats, seed=seed)
    train_loader = DataLoader(train_ds, batch_size=batch_size, shuffle=True, num_workers=2, pin_memory=device.type == "cuda")
    val_loader = None
    if val_paths:
        val_ds = OrientationDataset(val_paths, augment=False, repeats=1, seed=seed)
        val_loader = DataLoader(val_ds, batch_size=batch_size, shuffle=False)

    model = OrientationModelWrapper(arch).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-2)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs, eta_min=1e-5)
    criterion = nn.CrossEntropyLoss(label_smoothing=0.05)

    best_val_acc = -1.0
    best_epoch = epochs
    best_metrics: dict[str, Any] = {}
    best_state = None

    for epoch in range(1, epochs + 1):
        model.train()
        running_loss = 0.0
        for xb, yb in train_loader:
            xb, yb = xb.to(device), yb.to(device)
            optimizer.zero_grad()
            loss = criterion(model(xb), yb)
            loss.backward()
            optimizer.step()
            running_loss += float(loss.item()) * xb.size(0)
        scheduler.step()

        if val_loader is not None:
            metrics = evaluate_model(model, val_loader, device)
            score = metrics["accuracy"] + 0.01 * metrics["mean_pred_confidence"]
            if score > best_val_acc or (abs(score - best_val_acc) < 1e-6 and epoch > best_epoch):
                best_val_acc = score
                best_epoch = epoch
                best_metrics = metrics
                best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            if epoch in {1, 5, 10, 15, 20, epochs}:
                avg_loss = running_loss / len(train_ds)
                print(f"[{arch}] epoch {epoch:02d}/{epochs} loss={avg_loss:.4f} val_acc={metrics['accuracy']:.4f} conf={metrics['mean_pred_confidence']:.3f}")
        elif epoch in {1, 10, epochs}:
            avg_loss = running_loss / len(train_ds)
            print(f"[{arch} final] epoch {epoch:02d}/{epochs} loss={avg_loss:.4f}")

    if best_state is not None:
        model.load_state_dict(best_state)
    return model.cpu(), {"best_epoch": best_epoch, **best_metrics}


def export_and_verify_onnx(model: nn.Module, sample_paths: list[Path], output_path: Path) -> float:
    model.eval()
    dummy = torch.randn(1, 3, INPUT_SIZE, INPUT_SIZE, dtype=torch.float32)
    tmp_path = output_path.with_suffix(".tmp.onnx")
    torch.onnx.export(
        model,
        dummy,
        str(tmp_path),
        input_names=["input"],
        output_names=["logits"],
        dynamic_axes={"input": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=17,
        dynamo=False,
    )
    proto = onnx.load(str(tmp_path), load_external_data=True)
    onnx.save_model(proto, str(output_path), save_as_external_data=False)
    tmp_path.unlink(missing_ok=True)
    onnx_data_sidecar = output_path.with_suffix(".onnx.data")
    if onnx_data_sidecar.exists():
        onnx_data_sidecar.unlink()

    session = ort.InferenceSession(str(output_path), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    max_diff = 0.0
    test_ds = OrientationDataset(sample_paths[:6], augment=False, repeats=1)
    with torch.no_grad():
        for idx in range(len(test_ds)):
            tensor, label = test_ds[idx]
            batch = tensor.unsqueeze(0)
            torch_logits = model(batch).numpy()
            ort_logits = session.run(None, {input_name: batch.numpy()})[0]
            max_diff = max(max_diff, float(np.max(np.abs(torch_logits - ort_logits))))
            if int(np.argmax(ort_logits[0])) != label:
                raise RuntimeError(f"ONNX sanity mismatch on sample {idx}: pred={np.argmax(ort_logits[0])} target={label}")
    return max_diff


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Using device: {device}")

    all_pages = discover_pages(args.data_dir)
    val_paths = [path for group, path in all_pages if group in DEFAULT_VAL_GROUPS]
    train_paths = [path for group, path in all_pages if group not in DEFAULT_VAL_GROUPS]
    if not val_paths:
        split = max(1, len(all_pages) // 4)
        val_paths = [p for _, p in all_pages[-split:]]
        train_paths = [p for _, p in all_pages[:-split]]
    print(f"Pages: total={len(all_pages)}, train={len(train_paths)}, val={len(val_paths)}")

    candidates: dict[str, dict[str, Any]] = {}
    for arch in ("mobilenet_v3_small", "mobilenet_v3_large"):
        _, val_info = train_one_run(
            arch, train_paths, val_paths,
            epochs=args.epochs, batch_size=args.batch_size, lr=args.lr,
            repeats=args.repeats, seed=args.seed, device=device,
        )
        candidates[arch] = val_info

    # Prefer highest accuracy; tie-break toward smaller model (mobilenet_v3_small)
    best_arch = max(
        ("mobilenet_v3_small", "mobilenet_v3_large"),
        key=lambda a: (candidates[a]["accuracy"], candidates[a]["mean_pred_confidence"], 1 if a == "mobilenet_v3_small" else 0),
    )
    final_epochs = max(12, min(args.epochs, int(candidates[best_arch]["best_epoch"])))
    print(f"Selected best architecture: {best_arch} (val_acc={candidates[best_arch]['accuracy']}, final_epochs={final_epochs})")

    all_paths = [p for _, p in all_pages]
    final_model, _ = train_one_run(
        best_arch, all_paths, None,
        epochs=final_epochs, batch_size=args.batch_size, lr=args.lr,
        repeats=args.repeats, seed=args.seed, device=device,
    )
    model_out = args.output_dir / "model.onnx"
    max_diff = export_and_verify_onnx(final_model, val_paths, model_out)
    model_sha256 = sha256_file(model_out)
    size_mb = round(model_out.stat().st_size / (1024 * 1024), 3)

    metrics = {
        "selected_arch": best_arch,
        "total_pages": len(all_pages),
        "train_pages": len(train_paths),
        "val_pages": len(val_paths),
        "val_samples": len(val_paths) * 4,
        "candidates": candidates,
        "final_epochs": final_epochs,
        "onnx_max_abs_diff": max_diff,
        "model_size_mb": size_mb,
        "model_sha256": model_sha256,
    }
    provenance = {
        "model_name": "nyamuru-page-orientation-classifier",
        "backbone": best_arch,
        "license_notice": "Weights trained from torchvision ImageNet-1K MobileNetV3 backbone (BSD-3-Clause).",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "input_spec": {"name": "input", "shape": ["batch", 3, INPUT_SIZE, INPUT_SIZE], "range": "[0.0, 1.0]", "color": "RGB"},
        "output_spec": {"name": "logits", "classes_cw_degrees": list(ORIENTATION_CLASSES)},
        "dataset_pages": len(all_pages),
        "val_accuracy": candidates[best_arch]["accuracy"],
        "sha256": model_sha256,
        "size_bytes": model_out.stat().st_size,
    }
    (args.output_dir / "metrics.json").write_text(json.dumps(metrics, indent=2, ensure_ascii=False), encoding="utf-8")
    (args.output_dir / "provenance.json").write_text(json.dumps(provenance, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Exported {model_out} ({size_mb} MB, sha256={model_sha256[:12]}..., onnx_diff={max_diff:.2e})")
    print("M7_EXPORT_COMPLETE")


if __name__ == "__main__":
    main()
