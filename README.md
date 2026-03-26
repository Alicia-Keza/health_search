# MediSearch

A medical disease and symptom search web application built with Node.js, Express, and vanilla HTML/CSS/JS.

---

## Live Demo

| Server | URL | Role |
|--------|-----|------|
| Load Balancer | http://44.210.131.60 | Main entry point — share this |
| Web01 | http://54.152.40.73 | Direct access |
| Web02 | http://3.89.112.68 | Direct access |

🎥 **Demo Video:** [link-to-your-video]

---

## Features

- **Disease Search** — Search the WHO ICD-11 global disease database by name. Returns the ICD-11 code, definition, chapter, clinical notes, and synonyms.
- **Medicine Lookup** — Each disease result automatically fetches related FDA-listed drugs from OpenFDA.
- **Symptom Checker** — Type one or more symptoms (comma-separated or one at a time) and get an AI-powered analysis of possible conditions with descriptions and recommendations.
- **View Full Info** — Any result from the Symptom Checker links directly into the Disease Search tab.

---

## APIs Used

| API | Purpose | Documentation |
|-----|---------|---------------|
| WHO ICD-11 | Disease definitions, ICD-11 codes, synonyms | https://icd.who.int/icdapi |
| OpenFDA | Drug label and medicine data | https://open.fda.gov/apis/drug/label/ |
| AI Medical Diagnosis API (RapidAPI) | AI-powered symptom analysis and condition matching | https://rapidapi.com/bilgisamapi-api2/api/ai-medical-diagnosis-api-symptoms-to-results |

---

## Project Structure

```
health_search/
├── .gitignore          ← root gitignore (covers entire project)
├── README.md
├── Backend/
│   ├── .env            ← API keys (NOT committed to GitHub)
│   ├── package.json
│   └── server.js       ← Express server + all API proxy routes
└── Frontend/
    ├── index.html
    ├── styles.css
    └── script.js       ← Calls /api/... only, no keys exposed in browser
```

---

## Running Locally

**1. Clone the repository**
```bash
git clone https://github.com/Alicia-Keza/health_search.git
cd health_search
```

**2. Install backend dependencies**
```bash
cd Backend
npm install
```

**3. Configure environment variables**

Create `Backend/.env` with your credentials:
```
ICD_CLIENT_ID=your_icd_client_id
ICD_CLIENT_SECRET=your_icd_client_secret
RAPIDAPI_KEY=your_rapidapi_key
OPENFDA_KEY=your_openfda_key
PORT=3000
```

- WHO ICD-11 credentials → register at https://icd.who.int/icdapi
- RapidAPI key → subscribe to "AI Medical Diagnosis API" at https://rapidapi.com/bilgisamapi-api2/api/ai-medical-diagnosis-api-symptoms-to-results (free tier)
- OpenFDA key → register at https://open.fda.gov/apis/ (optional — increases rate limit; works without one)

**4. Start the server**
```bash
npm start
```

**5. Open your browser**
```
http://localhost:3000
```

For development with auto-restart on file changes:
```bash
npm run dev
```

---

## Deployment

### Servers Used

| Name | IP | OS |
|------|----|----|
| 7012-web-01 | 54.152.40.73 | Ubuntu |
| 7012-web-02 | 3.89.112.68 | Ubuntu |
| 7012-lb-01 | 44.210.131.60 | Ubuntu |

---

### Step 1 — Set up Web01 (54.152.40.73)

```bash
ssh ubuntu@54.152.40.73
```

Install Node.js and Nginx:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx
```

Clone the project and install dependencies:
```bash
cd /var/www
sudo git clone https://github.com/Alicia-Keza/health_search.git
sudo chown -R ubuntu:ubuntu /var/www/health_search
cd /var/www/health_search/Backend
npm install
```

Create the `.env` file manually (it is not on GitHub):
```bash
nano /var/www/health_search/Backend/.env
```
Paste your credentials, save and exit (`Ctrl+X → Y → Enter`).

Install PM2 to keep Node running after logout:
```bash
sudo npm install -g pm2
cd /var/www/health_search/Backend
pm2 start server.js --name health_search
pm2 save
pm2 startup
```

Configure Nginx to proxy requests to Node:
```bash
sudo nano /etc/nginx/sites-available/health_search
```

```nginx
server {
    listen 80;
    server_name _;

    location / {
        proxy_pass         http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host            $host;
        proxy_set_header   X-Real-IP       $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/health_search /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
curl http://localhost   # should return the app HTML
```

---

### Step 2 — Set up Web02 (3.89.112.68)

```bash
ssh ubuntu@3.89.112.68
```

Run the exact same commands as Web01:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs nginx

cd /var/www
sudo git clone https://github.com/Alicia-Keza/health_search.git
sudo chown -R ubuntu:ubuntu /var/www/health_search
cd /var/www/health_search/Backend
npm install

nano /var/www/health_search/Backend/.env
# paste credentials, save and exit

sudo npm install -g pm2
pm2 start server.js --name health_search
pm2 save
pm2 startup

sudo nano /etc/nginx/sites-available/health_search
# paste same Nginx config as Web01

sudo ln -s /etc/nginx/sites-available/health_search /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
curl http://localhost
```

---

### Step 3 — Set up Load Balancer (44.210.131.60)

```bash
ssh ubuntu@44.210.131.60
```

Install Nginx only (no Node needed on the load balancer):
```bash
sudo apt-get install -y nginx
```

Configure load balancer:
```bash
sudo nano /etc/nginx/sites-available/health_search-lb
```

```nginx
upstream health_search_backend {
    server 54.152.40.73:80;
    server 3.89.112.68:80;
}

server {
    listen 80;
    server_name _;

    location / {
        proxy_pass         http://health_search_backend;
        proxy_http_version 1.1;
        proxy_set_header   Host            $host;
        proxy_set_header   X-Real-IP       $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/health_search-lb /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

---

### Step 4 — Verify Everything Works

```bash
curl http://54.152.40.73     # Web01 direct
curl http://3.89.112.68      # Web02 direct
curl http://44.210.131.60    # Load balancer
```

To confirm traffic is being balanced between both servers, open the Nginx access logs on each web server while hitting the load balancer URL from your browser:
```bash
# On Web01
sudo tail -f /var/log/nginx/access.log

# On Web02
sudo tail -f /var/log/nginx/access.log
```

Refreshing http://44.210.131.60 multiple times should produce log entries on both servers.

---

## Challenges & How They Were Solved

**1. WHO ICD-11 OAuth token — CORS issue in the browser**
The WHO token endpoint blocks direct browser requests due to CORS. Initially the plan was to call it from the frontend, which failed. The fix was to move all WHO ICD-11 authentication and API calls to the Express backend, where CORS is not a restriction. The browser now only talks to our own `/api/...` routes, and the backend handles the token silently.

**2. Token expiry management**
The WHO ICD-11 access token expires after one hour. Without caching, every search would require a fresh token fetch, slowing down the app. The solution was to cache the token in memory on the server and store its expiry timestamp, only fetching a new one when the old one is within 60 seconds of expiry.

**3. OpenFDA returning unrelated drugs**
Searching broad terms like "malaria" in the FDA database returned many unrelated results. The fix was to search specifically inside the `indications_and_usage` field using exact-match syntax, and limit results to 3 to keep the UI clean.

**4. ApiMedic removed from RapidAPI**
The original symptom checker relied on ApiMedic via RapidAPI, which returned a 404 "API doesn't exists" error mid-development. Investigation confirmed the API had been delisted from the RapidAPI marketplace entirely. The fix was to switch to the AI Medical Diagnosis API (bilgisamapi), which accepts plain-text symptom arrays via POST, eliminating the need for a pre-loaded numeric symptom list and simplifying the frontend to a free-text tag input.

**5. Keeping API keys off GitHub**
Hardcoding keys in `script.js` would expose them in the public repository. The solution was to build an Express proxy server that reads keys from a `.env` file (excluded by `.gitignore`) and proxies all API calls, so the browser only ever sees our own backend routes.

---

## Security

- All API keys stored in `Backend/.env` — never committed to GitHub
- `.gitignore` at both root and backend level excludes `.env` and `node_modules`
- All API responses are HTML-escaped before rendering to prevent XSS attacks
- Input validation on all backend routes — missing parameters return a 400 error
- API calls proxied through our own backend so keys are never exposed client-side

---

## Libraries & Tools Used

| Tool | Purpose | Link |
|------|---------|------|
| Node.js | JavaScript runtime for the backend | https://nodejs.org |
| Express | Web framework for API routing | https://expressjs.com |
| node-fetch | HTTP client for server-side API calls | https://github.com/node-fetch/node-fetch |
| dotenv | Loads environment variables from `.env` | https://github.com/motdotla/dotenv |
| cors | Express middleware to allow cross-origin requests | https://github.com/expressjs/cors |
| PM2 | Process manager to keep Node running on the server | https://pm2.keymetrics.io |
| Nginx | Web server and load balancer | https://nginx.org |

---

## Credits

- [WHO ICD-11 API](https://icd.who.int/icdapi) — World Health Organization
- [OpenFDA](https://open.fda.gov) — U.S. Food & Drug Administration
- [AI Medical Diagnosis API](https://rapidapi.com/bilgisamapi-api2/api/ai-medical-diagnosis-api-symptoms-to-results) — bilgisamapi via RapidAPI