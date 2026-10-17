/* Read-only local Windows capability report viewer. No camera requests or persistent storage. */
(() => {
  'use strict';
  const SCHEMA = 'meetinglens.windows.capabilities.v1';
  const LIMIT = 1024 * 1024;
  const $ = id => document.getElementById(id);
  let generation = 0;
  const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const text = (value, maximum = 300) => typeof value === 'string' && value.length <= maximum;
  const unsigned = value => value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) || (typeof value === 'string' && /^\d{1,20}$/.test(value));
  function validate(report) {
    if (!plain(report) || report.schema !== SCHEMA) throw new Error('Choose a MeetingLens Windows capability report with the supported v1 schema.');
    if (!Array.isArray(report.effects) || report.effects.length > 64) throw new Error('The report has an invalid effects list.');
    for (const effect of report.effects) {
      if (!plain(effect) || !text(effect.id, 64) || !effect.id || !text(effect.label, 160) || typeof effect.supported !== 'boolean' || !Array.isArray(effect.modes) || effect.modes.length > 40 || !effect.modes.every(mode => text(mode, 160)) || !unsigned(effect.flags) || !unsigned(effect.capabilities) || (effect.error != null && !text(effect.error, 1000))) throw new Error('The report contains an invalid effect record.');
    }
    if (report.device !== undefined && (!plain(report.device) || !text(report.device.name, 300) || (report.device.idHash !== undefined && !text(report.device.idHash, 128)))) throw new Error('The report has invalid camera information.');
    for (const name of ['source', 'platform', 'osVersion', 'generatedAt']) if (report[name] !== undefined && !text(report[name], 300)) throw new Error('The report has invalid metadata.');
    for (const name of ['autoFraming', 'voiceFocus', 'npu', 'virtualCamera', 'zoom']) if (report[name] !== undefined && !plain(report[name])) throw new Error('The report has invalid capability information.');
    if (report.autoFraming?.supported !== undefined && typeof report.autoFraming.supported !== 'boolean') throw new Error('The report has invalid automatic framing information.');
    if (report.autoFraming?.currentMode != null && !text(report.autoFraming.currentMode, 100)) throw new Error('The report has an invalid framing mode.');
    for (const name of ['voiceFocus', 'npu', 'virtualCamera']) if (report[name]?.status !== undefined && !text(report[name].status, 200)) throw new Error('The report has an invalid capability status.');
    if (report.notes !== undefined && (!Array.isArray(report.notes) || report.notes.length > 40 || !report.notes.every(note => text(note, 2000)))) throw new Error('The report contains invalid notes.');
    if (report.formats !== undefined && (!Array.isArray(report.formats) || report.formats.length > 1000 || !report.formats.every(format => plain(format) && Number.isInteger(format.width) && format.width > 0 && format.width <= 32768 && Number.isInteger(format.height) && format.height > 0 && format.height <= 32768 && Number.isInteger(format.numerator) && format.numerator >= 0 && format.numerator <= 10000000 && Number.isInteger(format.denominator) && format.denominator > 0 && format.denominator <= 10000000 && text(format.subtype, 100)))) throw new Error('The report contains invalid video formats.');
    return report;
  }
  function node(tag, content, className) { const element = document.createElement(tag); if (content !== undefined) element.textContent = String(content); if (className) element.className = className; return element; }
  function status(message, kind = '') { $('nativeReportStatus').textContent = message; $('nativeReportStatus').className = `native-status ${kind}`.trim(); }
  function addCard(title, badge, available, description, rows = []) {
    const card = node('article', undefined, 'native-effect'); const heading = node('h3', title); heading.append(node('span', badge, `native-badge${available ? ' available' : ''}`)); card.append(heading, node('p', description));
    if (rows.length) { const list = node('dl'); for (const [key, value] of rows) { list.append(node('dt', key), node('dd', value)); } card.append(list); }
    $('nativeEffects').append(card);
  }
  function display(report) {
    $('nativeEffects').replaceChildren(); $('nativeFormatsList').replaceChildren(); $('nativeReportNotes').replaceChildren();
    $('nativeDeviceName').textContent = report.device?.name || 'Windows camera';
    const date = report.generatedAt && Number.isFinite(Date.parse(report.generatedAt)) ? new Date(report.generatedAt).toLocaleString() : report.generatedAt || 'Time not supplied';
    $('nativeReportMetadata').textContent = `${report.source || 'Windows companion'} · ${report.osVersion || report.platform || 'Windows'} · Reported ${date}. This is a snapshot, not a live connection.`;
    for (const effect of report.effects) {
      const rows = [['Available modes', effect.modes.length ? effect.modes.join(', ') : 'None reported']];
      if (effect.flags !== null) rows.push(['Current flags', String(effect.flags)]);
      if (effect.capabilities !== null) rows.push(['Capability flags', String(effect.capabilities)]);
      if (effect.error) rows.push(['Driver response', effect.error]);
      addCard(effect.label, effect.supported ? 'Supported in report' : 'Not available in report', effect.supported, 'A device capability reported by the separate Windows companion. Changing a control here is not supported.', rows);
    }
    if (report.autoFraming) addCard('Windows auto framing', report.autoFraming.supported ? 'Supported in report' : 'Not available in report', !!report.autoFraming.supported, 'The device’s Windows automatic framing control is separate from local face tracking in the MeetingLens preview.', [['Current mode', report.autoFraming.currentMode || 'Not reported']]);
    addCard('Windows Voice Focus', 'Windows settings', false, 'Inspect supported Windows microphone effects in Sound settings. This report does not enable them or connect the microphone to meeting apps.', [['Reported status', report.voiceFocus?.status || 'Not reported']]);
    addCard('NPU acceleration', 'Windows managed', false, 'Windows selects acceleration for its supported system effects. MeetingLens browser face tracking and segmentation use local CPU/WebAssembly processing.', [['Reported status', report.npu?.status || 'Not reported']]);
    addCard('Virtual camera output', 'Separate desktop application', false, 'MeetingLens Camera hosts the studio and supplies native video output. This imported capability report does not connect or verify that output. The standalone PWA does not install a camera device.', [['Reported status', report.virtualCamera?.status || 'Not reported'], ['Connection from this report', 'Not connected']]);
    const blur = report.effects.find(effect => effect.id === 'backgroundBlur' && effect.supported);
    let blurEnabled = false; try { blurEnabled = blur && blur.flags != null && (BigInt(blur.flags) & 1n) !== 0n; } catch (_) {}
    $('nativeDuplicateWarning').hidden = !blurEnabled;
    $('nativeDuplicateWarning').textContent = blurEnabled ? 'Windows background blur was active when this report was exported. Check its current setting before adding local blur or a second blur in your meeting app.' : '';
    const formats = report.formats || []; $('nativeFormats').hidden = !formats.length; $('nativeFormatsSummary').textContent = `${formats.length} reported camera format${formats.length === 1 ? '' : 's'}`;
    for (const format of formats) { const fps = format.numerator / format.denominator; $('nativeFormatsList').append(node('li', `${format.width} × ${format.height} · ${Number(fps.toFixed(3))} fps · ${format.subtype}`)); }
    for (const note of report.notes || []) $('nativeReportNotes').append(node('li', note));
    $('nativeReport').hidden = false;
    status('Report imported locally. Capabilities may change after camera, driver, or Windows updates. Nothing was uploaded or saved.', 'success');
  }
  $('nativeReportInput').addEventListener('change', async event => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    const token = ++generation;
    try {
      if (!file.size || file.size > LIMIT) throw new Error('Choose a non-empty JSON report no larger than 1 MB.');
      if (!file.name.toLowerCase().endsWith('.json')) throw new Error('Choose the .json file exported by the Windows companion.');
      const contents = await file.text(); if (token !== generation) return;
      let report; try { report = JSON.parse(contents); } catch (_) { throw new Error('This file is not valid JSON. Export a new report from the Windows companion.'); }
      display(validate(report));
    } catch (error) { if (token === generation) status(`${error.message} Any previously imported report remains visible.`, 'error'); }
  });
  $('nativeClearReport').addEventListener('click', () => { ++generation; $('nativeReport').hidden = true; $('nativeEffects').replaceChildren(); $('nativeFormatsList').replaceChildren(); $('nativeReportNotes').replaceChildren(); $('nativeDeviceName').textContent = ''; $('nativeReportMetadata').textContent = ''; status('Report cleared. This page does not probe or control your camera.'); $('nativeReportInput').focus(); });
})();
