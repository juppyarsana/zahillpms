module.exports = {
  apps: [{
    name: 'birdnest-pms',
    script: 'index.js',
    cwd: '/var/www/birdnest/server',
    instances: 1,
    autorestart: true,
    watch: false,
    env_production: {
      NODE_ENV: 'production',
      PORT: 4000,
    },
  }],
};
