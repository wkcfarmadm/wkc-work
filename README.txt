WKC Work Tracker – version 1
============================

A web app (PWA) for phones, tablets and PC. Works offline after the first open.
Admin PIN at first start: 1234  (change it in Admin -> Backup & PIN)

TRY IT ON YOUR PC (no camera)
1. Unzip this folder.
2. Double-click index.html (Chrome or Edge).
3. Use "Choose from list" instead of scanning.

PUT IT ON PHONES / TABLETS (camera + offline)
Cameras only work from an https:// address, so the folder must be hosted.
1. Go to https://app.netlify.com/drop and sign up (free).
2. Drag this whole folder (the one containing index.html) onto the page.
3. Netlify gives you a link like https://something.netlify.app – open it on each phone.
4. Android Chrome: menu ⋮ -> "Add to Home screen" / "Install app".
   iPhone Safari: Share -> "Add to Home Screen".
5. Open it once while online. After that it works without internet.

UPDATING THE APP LATER
Change the files, then in sw.js increase VERSION (e.g. wkc-v1.0.1), and drag the
folder onto your Netlify site's "Deploys" page again.

IMPORTANT IN VERSION 1
- Data is saved only on each device (no server sync yet).
- Copy the setup to other devices: Admin -> Backup & PIN -> Export setup, then Import on the other device.
- Collect records: on each device Admin -> "Full backup", then Import all backups on the admin device.
- Clearing the browser's data / uninstalling the app deletes that device's records. Export backups regularly.

FILES
index.html, css/styles.css   screens and look
js/app.js                    staff screens, time calculations
js/admin.js                  admin screens, QR stickers, reports, backup
js/db.js                     on-device database
js/scanner.js                camera QR scanning
lib/qrcode.js                QR code maker (MIT licence, Kazuhiko Arase)
sw.js                        offline support
