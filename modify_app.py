import os, re

base = r"C:\Users\Yjamp\.gemini\antigravity\scratch\webplayer-android\app\src\main\java\com\latmpx\player"

# 1. Models: add java.io.Serializable
models_path = os.path.join(base, "data", "Models.kt")
with open(models_path, "r", encoding="utf-8") as f:
    models_code = f.read()
models_code = models_code.replace("data class Category(", "data class Category(val id: String, val name: String, val kind: Kind) : java.io.Serializable {\n    constructor() : this(\"\", \"\", Kind.MOVIE)\n}\n// data class Category(")
# The regex above is bad. Let's do it safer.
