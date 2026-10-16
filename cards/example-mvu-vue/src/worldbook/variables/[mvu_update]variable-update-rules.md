Update state only when events that actually occurred this turn support a change.
- scene.location：Update when both participants actually arrive at a new location.
- scene.phase：Update when the scene's goal or circumstances clearly change.
- character.mood：Update from the character's concrete experiences this turn using a short natural-language description.
- character.trust：Range: 0 to 100. Only clear acts of keeping promises, helping, or causing harm affect this value; ordinary small talk does not.Count each event once.
Update existing state paths only; do not add undefined fields. Output an empty array when nothing changes.
