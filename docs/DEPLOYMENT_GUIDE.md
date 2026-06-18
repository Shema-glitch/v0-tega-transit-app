# Tega Transit API Deployment Guide

Since this backend is built with Next.js, it is highly optimized for deployment. I have already configured the codebase with `output: 'standalone'` in your `next.config.mjs` and created a `render.yaml` file, so deployment will be essentially plug-and-play.

Here are the top two platforms I recommend for hosting this exact architecture, along with step-by-step guides.

---

## Option 1: Render.com (Recommended for Background/Streaming tasks)
Render is fantastic for Node.js backends, especially because Server-Sent Events (SSE) require long-lived, persistent connections which Render handles brilliantly.

### Steps to Deploy on Render:
1. **Push to GitHub**: Make sure your entire project is committed and pushed to a GitHub repository.
2. **Create a Render Account**: Go to [Render.com](https://render.com) and sign up with GitHub.
3. **Use the Blueprint (Zero-Config)**:
   - On the Render dashboard, click **New +** and select **Blueprint**.
   - Connect your GitHub account and select your `v0-tega-transit-app` repository.
   - Render will automatically detect the `render.yaml` file I created earlier.
   - Click **Apply**. Render will automatically provision a Web Service for you!
4. **Set your Environment Variables**:
   - Once the service is created, click on it and go to the **Environment** tab.
   - Add the following keys from your `.env` file:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
     - `NEXT_SUPABASE_CONNECTION_STRING`
     - `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN`
5. **Done!** Render will run `npm run build` and launch your API. You will get a URL like `https://tega-transit-api.onrender.com`.

---

## Option 2: Vercel (The Native Next.js Platform)
Since you are using Next.js, Vercel (the creators of Next.js) is arguably the fastest and easiest place to host it. The edge caching we built (`CacheService`) works natively and flawlessly on Vercel.

### Steps to Deploy on Vercel:
1. **Push to GitHub**: Commit and push your code.
2. **Go to Vercel**: Visit [Vercel.com](https://vercel.com) and log in with GitHub.
3. **Import Project**:
   - Click **Add New... -> Project**.
   - Import your `v0-tega-transit-app` repository.
4. **Configure Environment Variables**:
   - In the deployment setup screen, open the **Environment Variables** dropdown.
   - Paste in your Supabase and Mapbox keys just like you did locally.
5. **Deploy**:
   - Click **Deploy**. Vercel will automatically build the project and give you a live URL within 60 seconds (e.g., `https://tega-transit.vercel.app`).

---

## ⚠️ Important Note on SSE and Hosting Platforms
Server-Sent Events (SSE) keep HTTP connections open for a long time. 
- **On Vercel**: If you use their free Tier (Serverless Functions), the connection might forcibly close after 10–15 seconds. If this happens, your frontend `EventSource` will automatically attempt to reconnect, but it's something to be aware of.
- **On Render**: Render uses persistent containers, meaning the SSE connection can stay open infinitely without dropping. **For a heavy realtime streaming app, Render is usually the better choice.**
