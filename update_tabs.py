import os
import re

approot_path = r"C:\Users\Yjamp\.gemini\antigravity\scratch\webplayer-android\app\src\main\java\com\latmpx\player\ui\AppRoot.kt"

with open(approot_path, "r", encoding="utf-8") as f:
    content = f.read()

pattern = re.compile(r'val phoneTabs = listOf\(Tab\.HOME, Tab\.MOVIES, Tab\.SERIES, Tab\.LIVE, Tab\.SPORTS, Tab\.SEARCH, Tab\.ACCOUNT\)')
new_content = pattern.sub(r'val phoneTabs = listOf(Tab.HOME, Tab.SERIES, Tab.MOVIES, Tab.LIVE, Tab.ACCOUNT)', content)

with open(approot_path, "w", encoding="utf-8") as f:
    f.write(new_content)

print("AppRoot tabs updated.")
