module.exports = {
  apps: [{
    name: 'zahill-pms',
    script: 'index.js',
    cwd: '/var/www/zahill/server',
    instances: 1,
    autorestart: true,
    watch: false,
    env_production: {
      NODE_ENV: 'production',
      PORT: 4000,
    },
  }],
};
