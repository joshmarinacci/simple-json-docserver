const fs = require('fs')
const path = require('path')

const server = require('./server')
console.log("env",process.env)
const CONFIG = {
    GITHUB_CLIENT_ID:process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET:process.env.GITHUB_CLIENT_SECRET,
    GITHUB_CALLBACK_URL:process.env.GITHUB_CALLBACK_URL,
    DIR:process.env.DIR,
    PORT:-1,
    ADMIN_USERS:['joshmarinacci'],
    SKIP_AUTH:(process.env.SKIP_AUTH==="true")?true:false,
    INSECURE_AUTH:false,
}
console.log("using config",CONFIG)

startup();

function startup() {
    //handle env vars first
    const args = process.argv.slice(2)
    // if (args.length < 2) throw new Error("missing docs dir and port");
    if(process.env.PORT) CONFIG.PORT = parseInt(process.env.PORT)

    args.filter(arg => arg.startsWith('--'))
        .forEach(param => {
            const parts = param.substring(2).split('=')
            CONFIG[parts[0]] = parts[1]
        })
    if(CONFIG.PORT !== -1) CONFIG.PORT = parseInt(CONFIG.PORT)
    console.log('using the config')
    console.log(CONFIG)

    server.startServer(CONFIG);
}
