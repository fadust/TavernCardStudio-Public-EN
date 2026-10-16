---
Variable update rules:
  scene:
    location:
      check:
        - Update when both participants actually arrive at a new location.
    phase:
      check:
        - Update when the scene's goal or circumstances clearly change.
  character:
    mood:
      check:
        - Update from the character's concrete experiences this turn using a short natural-language description.
        - Ordinary small talk does not change mood.
    trust:
      type: number
      range: 0~100
      check:
        - Only clear acts of keeping promises, helping, or causing harm affect this value; ordinary small talk does not.
        - Count each event once; each change must stay within ±10.
