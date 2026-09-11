# PRGTracker web dashboard

This folder is the deployable, read-only companion for PRGLauncher. Publish its
contents as the site directory in Netlify (or replace the current Netlify
project source with this folder). It reads only `public-dashboard/dashboard` in
Firestore; the desktop launcher creates that document automatically.

The dashboard never displays notes, Steam app IDs, download controls, or the
editable game catalogue. The existing launcher document remains private to the
desktop app.
