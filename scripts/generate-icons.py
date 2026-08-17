import os
from PIL import Image

src_img_path = r"C:\Users\yaman\.gemini\antigravity\brain\09c1ee93-1f85-44cd-9762-eadf8816250d\app_icon_1786972420825.jpg"
project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
assets_dir = os.path.join(project_dir, "assets")
public_dir = os.path.join(project_dir, "public")

os.makedirs(assets_dir, exist_ok=True)
os.makedirs(public_dir, exist_ok=True)

img = Image.open(src_img_path).convert("RGBA")

# 1. Save High-Res PNGs
img_512 = img.resize((512, 512), Image.Resampling.LANCZOS)
img_512.save(os.path.join(assets_dir, "app-icon.png"), format="PNG")
img_512.save(os.path.join(public_dir, "app-icon.png"), format="PNG")

# 2. Save Favicon PNG
img_64 = img.resize((64, 64), Image.Resampling.LANCZOS)
img_64.save(os.path.join(public_dir, "favicon.png"), format="PNG")

# 3. Save Multi-Resolution Windows ICO
icon_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
ico_path_assets = os.path.join(assets_dir, "icon.ico")
ico_path_public = os.path.join(public_dir, "favicon.ico")

img.save(ico_path_assets, format="ICO", sizes=icon_sizes)
img.save(ico_path_public, format="ICO", sizes=icon_sizes)

print("Generated icons successfully:")
print(" -", ico_path_assets)
print(" -", ico_path_public)
