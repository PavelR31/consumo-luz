"""
Servicio OCR para lectura de medidores eléctricos.

Usa EasyOCR para detectar dígitos en fotos de medidores.
Incluye pre-procesamiento de imagen para mejorar la precisión.
"""
import re
import logging
from pathlib import Path
from PIL import Image, ImageFilter, ImageEnhance
import numpy as np

logger = logging.getLogger(__name__)

# Lazy loading of EasyOCR to avoid slow startup
_reader = None


def _get_reader():
    """Lazy-load EasyOCR reader (downloads model on first use)."""
    global _reader
    if _reader is None:
        try:
            import easyocr
            _reader = easyocr.Reader(["en"], gpu=False)
            logger.info("EasyOCR reader initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize EasyOCR: {e}")
            raise
    return _reader


def preprocess_image(image_path: str) -> np.ndarray:
    """
    Pre-process meter photo to improve OCR accuracy.
    
    Steps:
    1. Convert to grayscale
    2. Enhance contrast
    3. Apply sharpening
    4. Resize for better digit recognition
    """
    img = Image.open(image_path)

    # Convert to grayscale
    img = img.convert("L")

    # Enhance contrast
    enhancer = ImageEnhance.Contrast(img)
    img = enhancer.enhance(2.0)

    # Enhance sharpness
    enhancer = ImageEnhance.Sharpness(img)
    img = enhancer.enhance(2.0)

    # Apply slight blur to reduce noise
    img = img.filter(ImageFilter.MedianFilter(size=3))

    # Ensure minimum size for OCR
    min_width = 800
    if img.width < min_width:
        ratio = min_width / img.width
        img = img.resize((int(img.width * ratio), int(img.height * ratio)), Image.LANCZOS)

    return np.array(img)


def extract_meter_reading(image_path: str) -> dict:
    """
    Extract meter reading from a photo.
    
    Returns:
        dict with keys:
        - detected_value: float or None
        - raw_text: str with all detected text
        - confidence: float 0-1
        - success: bool
        - message: str with status/error info
    """
    try:
        if not Path(image_path).exists():
            return {
                "detected_value": None,
                "raw_text": "",
                "confidence": 0.0,
                "success": False,
                "message": "Archivo de imagen no encontrado",
            }

        # Pre-process image
        processed = preprocess_image(image_path)

        # Run OCR
        reader = _get_reader()
        results = reader.readtext(processed, detail=1, paragraph=False)

        if not results:
            return {
                "detected_value": None,
                "raw_text": "",
                "confidence": 0.0,
                "success": False,
                "message": "No se detectó texto en la imagen",
            }

        # Extract all text and find numeric sequences
        all_text = ""
        numeric_candidates = []

        for bbox, text, confidence in results:
            all_text += f"{text} "
            # Look for sequences of digits (meter readings are typically 4-6 digits)
            cleaned = re.sub(r"[^0-9.]", "", text)
            if cleaned and len(cleaned) >= 3:
                try:
                    value = float(cleaned)
                    if 100 <= value <= 999999:  # Reasonable meter reading range
                        numeric_candidates.append({
                            "value": value,
                            "confidence": confidence,
                            "raw": text,
                        })
                except ValueError:
                    continue

        if not numeric_candidates:
            return {
                "detected_value": None,
                "raw_text": all_text.strip(),
                "confidence": 0.0,
                "success": False,
                "message": f"No se encontraron lecturas numéricas válidas. Texto detectado: {all_text.strip()}",
            }

        # Pick the candidate with highest confidence
        best = max(numeric_candidates, key=lambda x: x["confidence"])

        return {
            "detected_value": best["value"],
            "raw_text": all_text.strip(),
            "confidence": round(best["confidence"], 4),
            "success": True,
            "message": f"Lectura detectada: {best['value']} kWh (confianza: {best['confidence']:.1%})",
        }

    except Exception as e:
        logger.exception("Error processing meter image")
        return {
            "detected_value": None,
            "raw_text": "",
            "confidence": 0.0,
            "success": False,
            "message": f"Error procesando imagen: {str(e)}",
        }
