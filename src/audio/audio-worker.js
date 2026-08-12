'use strict';

(function () {
  const api = window.invisibleAudio;

  api.onStart(() => {
    // Real capture arrives in Task 4. Reporting readiness now proves the
    // main -> worker -> main IPC round trip before any media API is involved.
    api.ready();
  });

  api.onStop(() => {
    /* no capture to stop yet */
  });
})();
