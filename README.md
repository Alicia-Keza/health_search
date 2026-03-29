# HealthSearch

HealthSearch is a web app that lets you search for diseases and check your symptoms. It pulls information from the WHO ICD-11 database, Wikipedia, and the FDA drug database to give you a description of the disease, its symptoms, and related medications.

---

## Live Demo

| Server | URL | Role |
|--------|-----|------|
| Load Balancer | https://healthsearch.aliciak.tech | Main link |
| Web01 | http://54.152.40.73 | Direct access |
| Web02 | http://3.89.112.68 | Direct access |

🎥 **Demo Video:** [link-to-your-video]

---

## Features

- **Disease Search** — Search any disease by name and get a short description, symptoms, and medication.
- **Symptom Checker** — Tick symptoms from a checklist or type your own to find possible conditions with descriptions.
- **Medicine Lookup** — Fetches brand and generic drug names from OpenFDA. If nothing is found, it falls back to Wikipedia's treatment section.
- **Quick Search** — Shortcut buttons for common diseases like Malaria, Diabetes, and Hypertension.
- **View in Disease Search** — Any condition from the symptom checker has a button that jumps to the disease search tab and looks it up.
- **ICD-11 Code** — Each disease result shows its official WHO ICD-11 classification code.
- **Input Validation** — Disease search requires at least 3 characters and no special characters.
- **Error Handling** — Shows a clear message if something goes wrong or no results are found.
- **Responsive** — Works on both desktop and mobile.

---

## Why a Backend?

I used a Node.js backend instead of calling the APIs directly from the browser for two reasons. First, to keep the API keys safe — if I called the APIs from the frontend, anyone could see the keys in the browser. Second, some APIs like WHO ICD-11 block browser requests entirely, so the calls have to go through a server. The backend handles all the API calls and the browser only talks to my own routes.

---

## APIs Used

### 1. WHO ICD-11 API
**Provider:** World Health Organization
**Documentation:** https://icd.who.int/icdapi
**Requires Key:** Yes — free registration (Client ID + Client Secret)
**What it provides:** Disease search and ICD-11 codes. Also used for the symptom checker to find matching conditions.

---

### 2. Wikipedia REST API
**Provider:** Wikimedia Foundation
**Documentation:** https://en.wikipedia.org/api/rest_v1/
**Requires Key:** No
**What it provides:** Disease descriptions, symptoms, and treatment information.

---

### 3. OpenFDA
**Provider:** U.S. Food and Drug Administration
**Documentation:** https://open.fda.gov/apis/drug/label/
**Requires Key:** Yes — free key at https://open.fda.gov/apis/
**What it provides:** Drug names and medication information linked to a disease.

---

## Project Structure

```
health_search/
├── .gitignore          ← excludes .env and node_modules from GitHub
├── README.md
├── Backend/
│   ├── .env                ← API keys (not on GitHub)
│   ├── package.json
│   ├── package-lock.json
│   └── server.js           ← Express server, all API calls go through here
└── Frontend/
    ├── index.html
    ├── styles.css
    └── script.js       ← only calls our own /api/... routes
```

---

## Running Locally

**1. Clone the repo**
```bash
git clone https://github.com/Alicia-Keza/health_search.git
cd health_search
```

**2. Install dependencies**
```bash
cd Backend
npm install
```

**3. Create a `.env` file inside `Backend/`**
```
ICD_CLIENT_ID=your_icd_client_id
ICD_CLIENT_SECRET=your_icd_client_secret
OPENFDA_KEY=your_openfda_key
PORT=3000
```

Get your ICD-11 credentials at https://icd.who.int/icdapi and your OpenFDA key at https://open.fda.gov/apis/.

**4. Start the server**
```bash
npm start
```

**5. Open in browser**
```
http://localhost:3000
```

---

## Deployment

The app runs on two web servers (Web01 and Web02) with a load balancer (lb-01) in front that splits traffic between them.

### Architecture

```
User Browser
     │
     ▼
https://healthsearch.aliciak.tech
     │
     ▼
┌──────────────────────────────────┐
│  lb-01  (44.210.131.60)          │
│  HAProxy (SSL) + Nginx (routing) │
│  Round-robin load balancer       │
└──────────┬───────────────────────┘
           │
     ┌─────┴──────┐
     ▼            ▼
┌──────────┐  ┌──────────┐
│  web-01  │  │  web-02  │
│54.152... │  │ 3.89...  │
│ Node+PM2 │  │ Node+PM2 │
│  :3000   │  │  :3000   │
└──────────┘  └──────────┘
```

### Servers

| Name | IP | Role |
|------|----|------|
| 7012-web-01 | 54.152.40.73 | Web server |
| 7012-web-02 | 3.89.112.68 | Web server |
| 7012-lb-01 | 44.210.131.60 | Load balancer |

---

### Step 1 — Install Node.js and PM2 on Web01 and Web02

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
```

---

### Step 2 — Deploy the App on Web01 and Web02

```bash
cd /var/www
sudo git clone https://github.com/Alicia-Keza/health_search.git
sudo chown -R ubuntu:ubuntu /var/www/health_search
cd /var/www/health_search/Backend
npm install
```

Create the `.env` file manually (it's not on GitHub):
```bash
nano /var/www/health_search/Backend/.env
```
Paste your credentials and save with `Ctrl+X → Y → Enter`.

Start the app with PM2:
```bash
pm2 start server.js --name health_search
pm2 save
pm2 startup
```

---

### Step 3 — Set Up Nginx on Web01 and Web02

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
```

---

### Step 4 — Set Up the Load Balancer (lb-01)

```bash
sudo apt-get install -y nginx
sudo nano /etc/nginx/sites-available/health_search-lb
```

```nginx
upstream health_search_backend {
    server 54.152.40.73:80;
    server 3.89.112.68:80;
}

server {
    listen 80;
    server_name healthsearch.aliciak.tech;

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
sudo systemctl reload nginx
```

The `upstream` block tells Nginx to send requests to Web01 and Web02 in turns (round-robin).

---

### Step 5 — SSL (lb-01)

```bash
sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d healthsearch.aliciak.tech
```

Certbot automatically sets up HTTPS and redirects HTTP traffic to HTTPS.

---

### Step 6 — Updating the App

After pushing changes to GitHub, pull and restart on each server:
```bash
cd /var/www/health_search && git pull origin main && pm2 restart all --update-env
```

---

### Step 7 — Testing the Load Balancer

```bash
curl -I http://54.152.40.73
curl -I http://3.89.112.68
curl -I https://healthsearch.aliciak.tech
```

To confirm both servers are receiving traffic, open the logs on each server and refresh the site a few times:
```bash
sudo tail -f /var/log/nginx/access.log
```
You should see requests appearing on both Web01 and Web02.

---

## Challenges

**1. Finding a free API with enough data**
Most medical APIs I looked at were either paid or had very limited free tiers. I ended up using the WHO ICD-11 API because it is free and has the most complete disease data. I also added Wikipedia since it covers almost every disease and doesn't need a key.

**2. Symptom checker API kept failing**
I tried two different symptom checker APIs from RapidAPI. The first one got removed from the platform while I was building the project, and the second one ran out of free requests. In the end I used the ICD-11 search to match symptoms to conditions since I already had it set up.

**3. OpenFDA only has US drugs**
A lot of diseases like Malaria don't show up in OpenFDA because it only covers FDA-approved US drugs. I added Wikipedia's treatment section as a backup so there is always some medication info shown.

**4. SSL wouldn't work on the original domain**
The domain I had set up was `health_search.aliciak.tech` with an underscore. It turned out SSL certificates don't support underscores in domain names, so I had to create a new one — `healthsearch.aliciak.tech` — and get the certificate for that.

**5. API keys in a public repo**
Since the repository is public, I couldn't put the API keys in the code. I stored them in a `.env` file that is listed in `.gitignore` so it never gets pushed to GitHub. I create the file manually on each server after deploying.

---

## Security

- All API keys stored in `Backend/.env` — never committed to GitHub
- All API calls go through the Express backend so keys are never visible in the browser
- All data shown in the browser is HTML-escaped to prevent XSS attacks
- All backend routes check for required parameters and return a 400 error if anything is missing
- HTTPS enforced on the public domain via Let's Encrypt

---

## Tools Used

| Tool | Purpose |
|------|---------|
| Node.js | Backend runtime |
| Express | Web server and routing |
| node-fetch | Makes API calls from the server |
| dotenv | Loads the `.env` file |
| cors | Allows the frontend to talk to the backend |
| PM2 | Keeps the app running on the server |
| Nginx | Reverse proxy and load balancer |
| HAProxy | SSL termination on the load balancer |
| Let's Encrypt / Certbot | Free SSL certificate |

---

## Credits

- [WHO ICD-11 API](https://icd.who.int/icdapi) — World Health Organization
- [Wikipedia REST API](https://en.wikipedia.org/api/rest_v1/) — Wikimedia Foundation
- [OpenFDA](https://open.fda.gov) — U.S. Food & Drug Administration
