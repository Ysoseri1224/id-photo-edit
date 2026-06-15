import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image


FAST_INPUT_SIZE = 512


def image2bgr(input_image: np.ndarray) -> np.ndarray:
    if len(input_image.shape) == 2:
        input_image = input_image[:, :, None]
    if input_image.shape[2] == 1:
        return np.repeat(input_image, 3, axis=2)
    if input_image.shape[2] == 4:
        return input_image[:, :, 0:3]
    return input_image


def n_normalize(
    array: np.ndarray,
    mean: np.ndarray = np.array([0.5, 0.5, 0.5]),
    std: np.ndarray = np.array([0.5, 0.5, 0.5]),
) -> np.ndarray:
    im = array / 255.0
    im = np.divide(np.subtract(im, mean), std)
    return np.asarray(im, dtype=np.float32)


def n_to_tensor(array: np.ndarray) -> np.ndarray:
    return array.transpose((2, 0, 1))


def n_unsqueeze(array: np.ndarray, axis: int = 0) -> np.ndarray:
    if axis == 0:
        return array[None, :, :, :]
    if axis == 1:
        return array[:, None, :, :]
    if axis == 2:
        return array[:, :, None, :]
    return array[:, :, :, None]


def read_modnet_image(input_image: np.ndarray, ref_size: int = FAST_INPUT_SIZE) -> tuple[np.ndarray, int, int]:
    image = Image.fromarray(np.uint8(input_image))
    width, height = image.size[0], image.size[1]
    image_array = np.asarray(image)
    image_array = image2bgr(image_array)
    image_array = cv2.resize(image_array, (ref_size, ref_size), interpolation=cv2.INTER_AREA)
    image_array = n_normalize(
        image_array,
        mean=np.array([0.5, 0.5, 0.5]),
        std=np.array([0.5, 0.5, 0.5]),
    )
    image_array = n_unsqueeze(n_to_tensor(image_array))
    return image_array.astype(np.float32), width, height


def hollow_out_fix(src: np.ndarray) -> np.ndarray:
    b, g, r, a = cv2.split(src)
    src_bgr = cv2.merge((b, g, r))
    add_area = np.zeros((10, a.shape[1]), np.uint8)
    a = np.vstack((add_area, a, add_area))
    add_area = np.zeros((a.shape[0], 10), np.uint8)
    a = np.hstack((add_area, a, add_area))
    _, a_threshold = cv2.threshold(a, 127, 255, 0)
    a_erode = cv2.erode(
        a_threshold,
        kernel=cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)),
        iterations=3,
    )
    contours, _hierarchy = cv2.findContours(a_erode, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    contours = [contour for contour in contours]
    if not contours:
        return src
    contours.sort(key=lambda contour: cv2.contourArea(contour), reverse=True)
    a_contour = cv2.drawContours(np.zeros(a.shape, np.uint8), contours[0], -1, 255, 2)
    h, w = a.shape[:2]
    mask = np.zeros([h + 2, w + 2], np.uint8)
    cv2.floodFill(a_contour, mask=mask, seedPoint=(0, 0), newVal=255)
    a = cv2.add(a, 255 - a_contour)
    return cv2.merge((src_bgr, a[10:-10, 10:-10]))


def run_fast(input_image: Image.Image, model_path: Path) -> Image.Image:
    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    rgb_np = np.array(input_image.convert("RGB"))
    bgr_np = cv2.cvtColor(rgb_np, cv2.COLOR_RGB2BGR)
    tensor, width, height = read_modnet_image(bgr_np, ref_size=FAST_INPUT_SIZE)
    matte = session.run([output_name], {input_name: tensor})
    matte = (matte[0] * 255).astype("uint8")
    matte = np.squeeze(matte)
    mask = cv2.resize(matte, (width, height), interpolation=cv2.INTER_AREA)
    b, g, r = cv2.split(np.uint8(bgr_np))
    output = cv2.merge((b, g, r, mask))
    fixed = hollow_out_fix(output)
    alpha = cv2.split(fixed)[3]
    alpha_image = Image.fromarray(alpha, mode="L")
    rgba = input_image.convert("RGBA")
    rgba.putalpha(alpha_image)
    return rgba


def run_precise(input_image: Image.Image, model_path: Path) -> Image.Image:
    session = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])
    input_meta = session.get_inputs()[0]
    input_name = input_meta.name
    _batch, _channels, height, width = input_meta.shape

    resized = input_image.convert("RGB").resize((width, height), Image.LANCZOS)
    array = np.array(resized, dtype=np.float32) / 255.0
    mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
    std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
    array = (array - mean) / std
    array = array.transpose(2, 0, 1)[np.newaxis, ...].astype(np.float32)

    outputs = session.run(None, {input_name: array})
    mask = outputs[-1].squeeze()
    if mask.min() < 0 or mask.max() > 1.5:
        mask = 1.0 / (1.0 + np.exp(-mask))

    mask_min = mask.min()
    mask_max = mask.max()
    if mask_max - mask_min > 1e-8:
        mask = (mask - mask_min) / (mask_max - mask_min)

    mask = (mask * 255).clip(0, 255).astype(np.uint8)
    mask_image = Image.fromarray(mask, mode="L").resize(input_image.size, Image.LANCZOS)
    rgba = input_image.convert("RGBA")
    rgba.putalpha(mask_image)
    return rgba


def process_image(mode: str, input_path: Path, output_path: Path, model_path: Path) -> None:
    image = Image.open(input_path)
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGB")

    if mode == "fast_hivision_modnet":
        result = run_fast(image, model_path)
    elif mode == "precise_birefnet_general":
        result = run_precise(image, model_path)
    else:
        raise ValueError(f"Unknown mode: {mode}")

    result.save(output_path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Unified matting helper")
    parser.add_argument("--mode", required=True, help="Matting mode")
    parser.add_argument("--input", required=True, help="Input image path")
    parser.add_argument("--output", required=True, help="Output image path")
    parser.add_argument("--model", required=True, help="Model path")
    args = parser.parse_args()

    try:
        process_image(
            mode=args.mode,
            input_path=Path(args.input),
            output_path=Path(args.output),
            model_path=Path(args.model),
        )
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
