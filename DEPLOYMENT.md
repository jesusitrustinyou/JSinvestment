# JSInvestments Deployment Instructions

This project is ready to deploy as a single Node web service.
It serves the built React app and the API from the same Express server.

## Recommended host
Render is the simplest option for this repo because:
- the app needs both a frontend and backend
- the Express server already serves `dist/`
- the sync storage works best when the same server stays online

## What is already in the repo
- `server/index.js` serves the app and API
- `package.json` has a `build` script
- `render.yaml` is included for Render Blueprints

## Deploy on Render
1. Push this folder to GitHub.
2. Go to Render and create a new Blueprint deployment.
3. Connect the GitHub repo.
4. Render will read `render.yaml`.
5. It will run:
   - `npm install && npm run build`
   - `node server/index.js`
6. After deploy, Render gives you a public URL.

## Environment
No required environment variables are needed for the current build.
The app uses the built-in quote proxy and sync store.

## After deployment
Give your friend:
- the Render URL
- the sync code
- the encryption passphrase

## If you want a custom domain later
You can add one in Render after the first deploy.

## Important note
The app stores sync data in a local JSON file on the server instance.
That is fine for testing and small personal use, but for a production setup you would want a real database so data survives redeploys and scaling.
