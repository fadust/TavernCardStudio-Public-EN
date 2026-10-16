// Observe events without modifying chat history. Replace this handler as needed.
$(() => {
  const listener = eventOn(tavern_events.MESSAGE_RECEIVED, messageId => {
    console.debug('[Card script] Message received', messageId);
  });
  window.addEventListener('pagehide', () => listener.stop(), { once: true });
});
