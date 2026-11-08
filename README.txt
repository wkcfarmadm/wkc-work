WKC Work Tracker v2 — 3 apps, 1 shared database
================================================

Apps (after uploading to GitHub Pages):
  https://<username>.github.io/wkc-work/          -> choose an app
  https://<username>.github.io/wkc-work/admin/    -> Admin Dashboard (management)
  https://<username>.github.io/wkc-work/buah/     -> worker app: buah batang buang
  https://<username>.github.io/wkc-work/daun/     -> worker app: daun buang, Anak tanam, pokok masuk

ONE-TIME DATABASE SETUP (Supabase, free)
 1. supabase.com -> sign up -> New project (choose region Singapore). Save the database password.
 2. SQL Editor -> New query -> paste ALL of setup.sql -> Run.
 3. Authentication -> Sign In / Providers -> Email: turn OFF "Allow new users to sign up".
 4. Authentication -> Users -> Add user -> Create new user (tick Auto Confirm):
      admin account  (for the Admin Dashboard)
      staff account  (for all worker phones/tablets)
 5. SQL Editor: run  insert into public.app_admins (email) values ('<admin email>');
 6. Project Settings -> API (or Data API / API Keys): copy Project URL and the anon public key
    into shared/config.js.
 7. Upload all files to GitHub (replace the old version-1 files).

DEMO MODE: if shared/config.js is empty, the apps run on this device only (for trying).

UPDATING LATER: change files, then increase VERSION in admin/sw.js, buah/sw.js and daun/sw.js.

SECURITY
 - Only logged-in accounts can read or write data (Row Level Security in setup.sql).
 - Only emails in app_admins can change workers, plots, tables, varieties and plant counts.
 - Nobody can delete work records through the apps.
 - The anon key in config.js is meant to be public; the database rules protect the data.
 - Keep the admin and staff passwords private. Change them in Supabase if someone leaves.

FILES
 setup.sql            database tables, security rules, starting data
 shared/config.js     your Supabase address + key (edit this)
 shared/*.js          code used by all apps (store = on-device data, sync = upload/download)
 admin/ buah/ daun/   the three apps
