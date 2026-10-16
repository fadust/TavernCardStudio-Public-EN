Variable update rules:
  fogharbor:
    timeOfDay:
      check:
        - Update only when time explicitly advances; use Early morning, Morning, Noon, Afternoon, Evening, or Late night.
    weather:
      check:
        - Update on observable changes; use Fog, Light fog, Dense fog, Light rain, Overcast, or Clear.
    fogDensity:
      type: number
      range: 0~100
      check:
        - Use delta for an observable change in density. Fog is heavier after nightfall, at high tide, and near the sea; lighter indoors or downwind.
        - Change at most ±20 per turn; prose mood alone does not change the value.
  bureau:
    caseFile:
      id:
        check:
          - Assign an identifier such as WG-07 when formally registering a new case. Keep the same identifier throughout the case and after closure.
      name:
        check:
          - On registration, summarize the request in a short phrase matching the register.
      phase:
        check:
          - Use Standby, Intake, Inspection, Verification, or Closed. Advance when the preceding phase's goal is met; a formally accepted new case starts at Intake.
          - For example, move from Intake to Inspection after securing the scene's facts.
    clues:
      type: |-
        { [clueName: string]: { status: string, description: string } }
      check:
        - Use insert for new verifiable facts at a scene. Choose a short noun phrase as the key; describe facts rather than speculation.
        - Use replace to mark a clue Verified when supported by evidence or testimony, or RuledOut when disproved.
        - Status is Pending, Verified, or RuledOut. Do not update without new facts.
        - Keep established keys stable. To split a clue, insert a new record and remove the old one.
    people:
      type: |-
        { [personName: string]: { stance: string, trust: number, notes: string } }
      check:
        - Use insert after actually meeting an unregistered person; use a full name or stable title.
        - Stance is Partner, Cooperative, Neutral, Evasive, Hostile, or Unknown. Trust ranges from 0 to 100.
        - Adjust trust with delta from actual conduct this turn, at most ±10 per event. Small talk does not change it.
        - Notes describe verifiable identity or connection to the case rather than judgments.
    evidence:
      type: |-
        { [evidenceName: string]: { description: string, quantity: number } }
      check:
        - Use insert when physical evidence is obtained or sealed. Secured items remain at the Bureau instead of following characters.
        - Quantity is a nonnegative integer. Use delta only for transfers, consumption, or damage this turn; never reduce below zero. Omit unchanged fields.
  investigator:
    energy:
      type: number
      range: 0~100
      check:
        - Use delta to reduce after prolonged fieldwork, lost sleep, or injury, by at most 15 per event.
        - Restore after explicit rest, food, or a shift change, by at most 20 per event.
    clearance:
      check:
        - Update only when the director explicitly grants or revokes authority; use Trainee, Officer, or Special.
    renown:
      type: number
      range: 0~100
      check:
        - Increase after a closed case is confirmed by City Hall, by at most 10.
        - Decrease after unlawful evidence collection or rejected findings, by at most 10.
