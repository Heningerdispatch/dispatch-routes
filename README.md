# Dispatch Routes

Winter route app for Heninger Landscaping crews. Crews sign in with their name and a 6-digit PIN, start and complete each site (with GPS), and confirm their Nektar Task & FLHA. The office sees every route live, fixes mistakes, edits routes and sites, manages people and PINs, and saves reports.

- **Crew app:** `index.html` (installable on a phone's home screen; works without signal and sends when back in range)
- **Office dashboard:** `admin.html`
- **One-time setup:** `setup.html`

## How it's built

- Plain HTML, CSS and JavaScript, hosted free on GitHub Pages. No build step.
- Data and sign-in: Firebase (Firestore + Authentication, free Spark plan). `js/firebase-config.js` holds the project's public web config; access is controlled by `firestore.rules`.
- Client addresses, notes, crew names and visit records live only in Firestore behind sign-in, never in this repository.

## Setup (once)

1. Firebase project with Firestore (production mode) and Email/Password sign-in turned on.
2. GitHub Pages: Settings → Pages → Deploy from branch → `main` / root.
3. Open `setup.html`, create the owner's office login, copy the rules it shows into Firestore → Rules, and publish.
4. Open `admin.html`, finish setup, then import the starting data file on **Import & backup**.
5. Add people and make PINs on **People & PINs**.

## Site maps

Put PDF or image files in a `maps/` folder in this repository, then enter the file name on the site in **Routes & sites**. Files in this repository are public, so keep gate codes and other private details out of the maps; put those in the site's Access note instead.

## Testing

`test/backend-mock.js` is an in-memory stand-in for Firebase used by automated browser tests. It isn't used by the live app.
