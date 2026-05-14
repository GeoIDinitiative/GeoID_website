# Shared color table: FIRST_Un_2 value → (R, G, B) / hex
# Imported by both rasterize_geology.py and build_geology_features.py

UN2_COLORS_RGB = {
    # ── Crater-type units (reds / rusts) ────────────────────────────────────
    "Crater Unit":                                           (192,  80,  48),
    "Lower Crater Unit":                                     (176,  64,  40),
    "Upper Crater Unit":                                     (208, 100,  56),
    "Crater Undivided Unit":                                 (184,  72,  44),
    "Crater Cluster Unit":                                   (200, 104,  72),
    "Crater Fracture Floor Unit":                            (200, 120,  88),
    "Secondary Crater Unit":                                 (208, 144, 128),
    "Imbrium Crater Unit":                                   (168,  56,  32),
    "Basin Secondary Crater Unit":                           (192, 128, 112),

    # ── Mare / volcanic units (blues) ────────────────────────────────────────
    "Mare Unit":                                             ( 58,  90, 160),
    "Lower Mare Unit":                                       ( 42,  74, 144),
    "Upper Mare Unit":                                       ( 74, 106, 176),
    "Mare Dome Unit":                                        ( 96, 128, 192),
    "Dark Mantling Unit":                                    ( 48,  56,  64),

    # ── Highland / terra units (golds / tans) ────────────────────────────────
    "Terra Unit":                                            (200, 160,  48),
    "Terra Dome Unit":                                       (216, 176,  64),
    "Plains Unit":                                           (208, 184, 112),
    "Plains and Mantling, Terra Unit":                       (212, 192, 128),
    "Plateau Unit":                                          (200, 176,  96),

    # ── Basin units (olive / sage) ────────────────────────────────────────────
    "Basin Undivided Unit":                                  (112, 104,  64),
    "Basin Massif Unit":                                     (128, 120,  80),
    "Basin Lineated Unit":                                   ( 96,  88,  48),

    # ── Grooved terrain ──────────────────────────────────────────────────────
    "Grooved Terrain Unit":                                  (104, 120, 160),

    # ── Imbrium formation units (steel blue) ─────────────────────────────────
    "Imbrium Alpes Formation Unit":                          (112, 144, 168),
    "Imbrium Apenninus Formation Unit":                      (128, 152, 176),
    "Imbrium Fra Mauro Formation Unit":                      ( 96, 128, 160),

    # ── Orientale formation units (purple-grey) ──────────────────────────────
    "Orientale Hevelius Formation, Inner Facies Unit":       (144, 120, 136),
    "Orientale Hevelius Formation, Secondary Crater Facies Unit": (160, 136, 152),
    "Orientale Maunder Formation Unit":                      (120, 104, 128),
    "Orientale Montes Rook Formation, Massif Facies Unit":   (136, 128, 152),
    "Orientale Montes Rook Formation, Knobby Facies Unit":   (128, 120, 144),

    # ── Nectaris ─────────────────────────────────────────────────────────────
    "Nectaris Janssen Formation Unit":                       (176, 128,  64),
}

def rgb_to_hex(r, g, b):
    return f"#{r:02X}{g:02X}{b:02X}"

UN2_COLORS_HEX = {k: rgb_to_hex(*v) for k, v in UN2_COLORS_RGB.items()}
DEFAULT_RGB = (160, 160, 160)
DEFAULT_HEX = "#A0A0A0"
