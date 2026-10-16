// Fogharbor Bureau buttons read MVU state and display summaries without changing chat history or variables.
// Register buttons and listeners in $(); stop listeners on pagehide. Stable names and a guard plus
// appendInexistentScriptButtons keep repeated loads from duplicating buttons.
$(() => {
  const guard = '__fogharborBureauButtonsRegistered';
  if (window[guard]) return;
  window[guard] = true;
  let unloaded = false;

  const caseFileButton = 'View current case';
  const fogDensityButton = 'Fog report';
  const timeoutMs = 15000;

  appendInexistentScriptButtons([
    { name: caseFileButton, visible: true },
    { name: fogDensityButton, visible: true },
  ]);

  const notify = message => {
    if (typeof toastr !== 'undefined' && typeof toastr.info === 'function') toastr.info(message);
    else console.info('[Fogharbor Bureau]', message);
  };

  // Wait for MVU before reading; add a timeout because waitGlobalInitialized has none.
  async function readState() {
    let timer;
    try {
      await Promise.race([
        waitGlobalInitialized('Mvu'),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('MVU was not ready within 15 seconds. Enable the card’s MVU scripts and check that public dependencies can load.')), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
    return Mvu.getMvuData({ type: 'message', message_id: 'latest' })?.stat_data ?? null;
  }

  async function show(handle) {
    try {
      const status = await readState();
      if (unloaded) return;
      if (!status || typeof status !== 'object') {
        notify('No variable state is available. Complete a greeting or variable update for this card, then try again.');
        return;
      }
      handle(status);
    } catch (error) {
      if (unloaded) return;
      notify('Could not read state: ' + (error?.message ?? String(error)));
    }
  }

  const listeners = [
    eventOn(getButtonEvent(caseFileButton), () =>
      show(status => {
        const caseFile = status.bureau?.caseFile ?? {};
        const lines = [
          `ID: ${caseFile.id ?? 'Not registered'}`,
          `Name: ${caseFile.name ?? 'Not registered'}`,
          `Phase: ${caseFile.phase ?? 'Not registered'}`,
        ];
        const progress = status.bureau?._progress;
        if (typeof progress === 'string' && progress) lines.push(`Clues: ${progress}`);
        if (status.investigator?.clearance) lines.push(`Clearance: ${status.investigator.clearance}`);
        notify(lines.join(' | '));
      }),
    ),
    eventOn(getButtonEvent(fogDensityButton), () =>
      show(status => {
        const fogharbor = status.fogharbor ?? {};
        const value = Number(fogharbor.fogDensity);
        const lines = [
          `Time: ${fogharbor.timeOfDay ?? 'Not recorded'}`,
          `Weather: ${fogharbor.weather ?? 'Not recorded'}`,
        ];
        if (Number.isFinite(value)) {
          const densityLabel = value >= 80 ? 'Harbor night operations suspended' : value >= 55 ? 'Dense fog' : value >= 30 ? 'Moderate fog' : 'Light fog';
          lines.push(`Fog density: ${value} (${densityLabel})`);
        } else {
          lines.push('Fog density: Not recorded');
        }
        notify(lines.join(' | '));
      }),
    ),
  ];

  window.addEventListener(
    'pagehide',
    () => {
      unloaded = true;
      for (const listener of listeners) listener?.stop?.();
      window[guard] = false;
    },
    { once: true },
  );
});
