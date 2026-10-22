/**
 * Android Auto Backup rules.
 *
 * Android copies app data to the user's Google account about once a day
 * (on Wi-Fi, while charging) and restores it when the app is reinstalled on a
 * new phone with the same account. The quota is 25 MB, and if an app goes over
 * it nothing is backed up at all, so we include only:
 *   files/SQLite/   the database (a few MB even after years)
 *   files/backups/  the daily snapshots (compressed records, no photos)
 * Photos (files/attachments/) are left out of the cloud copy but included in a
 * phone-to-phone transfer, which has no size limit.
 */
const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const FULL_BACKUP = `<?xml version="1.0" encoding="utf-8"?>
<!-- Android 11 and older -->
<full-backup-content>
  <include domain="file" path="SQLite/" />
  <include domain="file" path="backups/" />
  <!-- -wal/-shm change while the app writes; a torn copy would not open. The database file
       is checkpointed regularly and the daily snapshots are self-verifying. -->
  <exclude domain="file" path="SQLite/bluemoon.db-wal" />
  <exclude domain="file" path="SQLite/bluemoon.db-shm" />
</full-backup-content>
`;

const EXTRACTION = `<?xml version="1.0" encoding="utf-8"?>
<!-- Android 12 and newer -->
<data-extraction-rules>
  <cloud-backup>
    <include domain="file" path="SQLite/" />
    <include domain="file" path="backups/" />
    <exclude domain="file" path="SQLite/bluemoon.db-wal" />
    <exclude domain="file" path="SQLite/bluemoon.db-shm" />
  </cloud-backup>
  <device-transfer>
    <include domain="file" path="SQLite/" />
    <include domain="file" path="backups/" />
    <include domain="file" path="attachments/" />
  </device-transfer>
</data-extraction-rules>
`;

function withRuleFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'bluemoon_backup_rules.xml'), FULL_BACKUP);
      fs.writeFileSync(path.join(dir, 'bluemoon_extraction_rules.xml'), EXTRACTION);
      return cfg;
    },
  ]);
}

function withManifestAttrs(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    if (app) {
      app.$['android:allowBackup'] = 'true';
      app.$['android:fullBackupContent'] = '@xml/bluemoon_backup_rules';
      app.$['android:dataExtractionRules'] = '@xml/bluemoon_extraction_rules';
    }
    return cfg;
  });
}

module.exports = function withBackupRules(config) {
  return withManifestAttrs(withRuleFiles(config));
};
