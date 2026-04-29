#!/bin/bash
set -e

# Update and install dependencies
apt-get update
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs nginx git certbot python3-certbot-nginx

# Install PM2
npm install -g pm2

# Clone repo
rm -rf /var/www/evalchains
git clone https://github.com/Onesignature/evalchain.git /var/www/evalchains

# Create .env
cat << 'EOF' > /var/www/evalchains/.env
FT_CLIENT_ID=u-s4t2ud-8d608449775eef66ae743df567df0e47c1723739eb1678826b8b2de6bbcbaaae
FT_CLIENT_SECRET=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
PUBLIC_URL=https://evalchains.com
EOF

# Build app
cd /var/www/evalchains/web
npm install
npm run build

# Start app with PM2
pm2 delete evalchains || true
pm2 start npm --name "evalchains" -- run start
pm2 save
pm2 startup | grep "sudo env" | bash || true

# Setup Nginx
cat << 'EOF' > /etc/nginx/sites-available/evalchains
server {
    listen 80;
    server_name evalchains.com www.evalchains.com 142.93.207.78;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
EOF

ln -sf /etc/nginx/sites-available/evalchains /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
systemctl restart nginx

echo "SETUP COMPLETE!"
