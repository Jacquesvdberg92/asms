import test from 'node:test';
import assert from 'node:assert/strict';
import { explainUpdateFailure } from '../lib/steamcmd.js';

const RAW = "App '2430930' state is 0x6 after update job";
const INSTALL = 'C:\\ASA\\servers\\markscreative';

/**
 * Lifted from a real content_log.txt, on a real machine, on the day an update
 * refused to run and the console had nothing to say but 0x6.
 */
const REAL_LOG = `[2026-09-06 12:41:01] Client version: 1788292693
[2026-09-06 12:41:01] Loaded 1 apps from install folder "c:\\asa\\servers\\markscreative\\steamapps\\appmanifest_*.acf".
[2026-09-06 12:41:02] AppID 2430930 state changed : Update Required,Fully Installed,Update Queued,
[2026-09-06 12:41:03] AppID 2430930 App update changed : Running Update,Reconfiguring,
[2026-09-06 12:41:03] CDepotDownloadMgr::BYldRequestDepotManifest(App: 2430930, Depot: 2430931, Manifest: 2850497868709574039, branch: ): Failed to get manifest request code, 'Access Denied'
[2026-09-06 12:41:03] AppID 2430930 update canceled : Failed downloading 1 manifests (No connection)
[2026-09-06 12:41:03] AppID 2430930 scheduler finished : removed from schedule (result No connection, state 0xe)`;

test('steamcmd: the manifest Steam will not serve is named, not left as 0x6', () => {
  const message = explainUpdateFailure(INSTALL, RAW, REAL_LOG);

  assert.match(message, /state is 0x6/, 'SteamCMD\u2019s own words are kept');
  assert.match(message, /no longer|stops being the public one/i, 'and the reason is added');
  // The fix has to be in the message, because the log it came from is not
  // somewhere anybody thinks to look.
  assert.match(message, /Verify integrity/i);
  assert.match(message, /appmanifest_2430930\.acf/, 'and the file to delete if that fails');
});

test('steamcmd: "No connection" alone is not mistaken for a network fault', () => {
  // Steam wraps the real failure in its own generic wording. Believing that
  // sends people to restart a router that was never the problem.
  const message = explainUpdateFailure(INSTALL, RAW, REAL_LOG);
  assert.doesNotMatch(message, /check your (internet|network|connection)/i);
});

test('steamcmd: a full disk is called a full disk', () => {
  const log = `Client version: 1788292693
AppID 2430930 update canceled : Not enough disk space`;
  assert.match(explainUpdateFailure(INSTALL, RAW, log), /ran out of room/i);
});

test('steamcmd: an unrecognised failure hands over the line and the log path', () => {
  const log = `Client version: 1788292693
AppID 2430930 update canceled : Something nobody has seen before`;
  const message = explainUpdateFailure(INSTALL, RAW, log);
  assert.match(message, /Something nobody has seen before/);
  assert.match(message, /content_log\.txt/);
});

test('steamcmd: only the run that failed is read, not the one before it', () => {
  // The log is append-only across runs, so a fault from an hour ago must not
  // be reported as the reason this one stopped.
  const log = `Client version: 1
AppID 2430930 update canceled : Not enough disk space

Client version: 1
AppID 2430930 update canceled : Something else entirely`;
  const message = explainUpdateFailure(INSTALL, RAW, log);
  assert.doesNotMatch(message, /ran out of room/i);
  assert.match(message, /Something else entirely/);
});

test('steamcmd: with no log at all the original message survives untouched', () => {
  assert.equal(explainUpdateFailure(INSTALL, RAW, ''), RAW);
});
