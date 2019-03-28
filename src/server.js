console.log("starting the json doc server")

const cors = require('cors')
const bodyParser = require('body-parser')
const fs = require('fs')
const express = require('express')
const path = require('path')
const NEDB = require('nedb')
const passport = require('passport')
const GithubStrategy = require('passport-github')

const USERS = {}
const CONFIG = {
    GITHUB_CLIENT_ID:process.env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET:process.env.GITHUB_CLIENT_SECRET,
    GITHUB_CALLBACK_URL:process.env.GITHUB_CALLBACK_URL,
    DIR:process.env.DIR,
    PORT:-1,
    ADMIN_USERS:['joshmarinacci'],
    SKIP_AUTH:true,
    INSECURE_AUTH:true,
}

let DB = null

function checkAuth(req,res,next) {
    if(CONFIG.SKIP_AUTH) {
        req.username = 'joshmarinacci'
        return next()
    }
    if(CONFIG.INSECURE_AUTH===true) {
        console.log("params",req.params, req.query)
        const token=req.query.accesstoken
        req.username = user.username
        if(req.user) return next()
    }
    if(!req.headers['access-key']) return res.json({success:false,message:'missing access token'})
    const token = req.headers['access-key']
    const user = USERS[token]
    if(!user) return res.json({success:false,message:'invalid access token, cannot find user'})
    next()
}

function checkAdminAuth(req,res,next) {
    if(CONFIG.SKIP_AUTH) {
        req.username = 'joshmarinacci'
        return next()
    }
    if(!req.headers['access-key']) return res.json({success:false,message:'missing access token'})
    const token = req.headers['access-key']
    const user = USERS[token]
    if(!user) return res.json({success:false,message:'invalid access token, cannot find user'})
    if(CONFIG.ADMIN_USERS.indexOf(user.username) < 0) {
        return res.json({success:false,message:'this user is not allowed to update the queue'})
    }
    next()
}

function setupRoutes(app) {
    app.get('/info',(req,res)=>{
        res.json({
            authUrl:'https://www.yahoo.com/'
        })
    })
    app.get('/auth/github/login', (req,res)=>{
        const url = `https://github.com/login/oauth/authorize?client_id=${CONFIG.GITHUB_CLIENT_ID}&redirect_uri=${CONFIG.GITHUB_CALLBACK_URL}`
        console.log("requesting github login with url", url)
        res.json({action:'open-window', url:url})
    })
    app.get('/auth/github/callback',
        passport.authenticate('github', {session:false}), (req,res) => {
            console.log("successfully authenticated from github")
            res.send(`<html>
<body>
    <p>great. you are authenticated. you may close this window now.</p>
    <script>
        document.body.onload = function() {
            const injectedUser = ${JSON.stringify(req.user)}
            console.log("the user is",injectedUser)
            const msg = {payload:injectedUser, status:'success'}
            console.log("msg",msg)
            console.log('location',window.opener.location,'*')
            window.opener.postMessage(msg, '*')
            console.log("done posting a message")
        }
</script>
</body>
</html>`)
        })

    app.get('/admin/list', checkAdminAuth, (req,res)=>{
        console.log("listing all the files")
        return new Promise((res,rej)=>{
            DB.find({type:'*', user:'*', $not:{archived:true}})
                .sort({timestamp:-1})
                .exec((err,docs)=>{
                    if(err) return rej(err)
                    return res(docs)
                })
        }).then(docs => res.json(docs))
    })
    app.get('/userinfo', checkAuth, (req,res) => {
        console.log("checking username",req.username)
        if(req.username) {
            return res.json({username:req.username})
        }
        res.json({success:false,message:"no user found with access token"+req.query.accesstoken})
    })

    app.get('/list/', checkAuth, (req,res)=>{
        return new Promise((res,rej)=>{
            DB.find({type:'*', username:req.username, $not:{archived:true}})
                .sort({timestamp:-1})
                .exec((err,docs)=>{
                    if(err) return rej(err)
                    return res(docs)
                })
        }).then(docs => res.json(docs))
    })

}

function startServer() {
    DB = new NEDB({filename: CONFIG.DB_FILE, autoload:true})
    //create the server
    const app = express()
    //make json formatting of REST APIs be pretty
    app.set("json spaces",4)
    //turn on CORS, Cross Origin Resource Sharing. allow all origins
    app.use(cors({origin:"*"}))
    //assume all bodies will be JSON and parse them automatically
    app.use(bodyParser.json({limit:'20MB'}))

    //setup passport for github auth
    passport.use(new GithubStrategy({
        clientID: CONFIG.GITHUB_CLIENT_ID,
        clientSecret: CONFIG.GITHUB_CLIENT_SECRET,
        callbackURL: CONFIG.GITHUB_CALLBACK_URL
    },function(accessToken, refreshToken, profile, done) {
        console.log("passport callback")
        //store the user profile in memory by access token
        USERS[accessToken] = profile
        console.log("the user is", USERS[accessToken])
        console.log('access token is', accessToken)
        done(null, {id:profile.id, accessToken: accessToken})
    }))

    app.use(passport.initialize())


    setupRoutes(app)


    app.listen(CONFIG.PORT, () => console.log(`
doc server http://localhost:${CONFIG.PORT}/ 
database  ${CONFIG.DB_FILE}
docs dir ${CONFIG.DOCS_DIR}
assets dir ${CONFIG.ASSETS_DIR}
        `))
}

startup();

function startup() {
    //handle env vars first
    const args = process.argv.slice(2)
    if (args.length < 2) throw new Error("missing docs dir and port");
    if(process.env.PORT) CONFIG.PORT = parseInt(process.env.PORT)

    args.filter(arg => arg.startsWith('--'))
        .forEach(param => {
            const parts = param.substring(2).split('=')
            CONFIG[parts[0]] = parts[1]
        })
    if(CONFIG.PORT !== -1) CONFIG.PORT = parseInt(CONFIG.PORT)
    console.log('using the config')
    console.log(CONFIG)

    //handle args next
    if(!fs.existsSync(CONFIG.DIR)) throw new Error(`dir doesn't exist: "${CONFIG.DIR}"`)
    CONFIG.DOCS_DIR = path.join(CONFIG.DIR,'docs')
    CONFIG.ASSETS_DIR = path.join(CONFIG.DIR,'assets')
    CONFIG.DB_FILE = path.join(CONFIG.DIR,'database.db')
    if(!fs.existsSync(CONFIG.DIR)) throw new Error(`dir doesn't exist: "${CONFIG.DIR}"`)
    if(!fs.existsSync(CONFIG.DOCS_DIR)) throw new Error(`docs dir doesn't exist: "${CONFIG.DOCS_DIR}"`)
    if(!fs.existsSync(CONFIG.ASSETS_DIR)) throw new Error(`docs dir doesn't exist: "${CONFIG.ASSETS_DIR}"`)
    if(CONFIG.PORT === -1) throw new Error(`missing port number`)

    startServer();
}

//call nedb.find as a promise
function pFind(query,options) {
    return new Promise((res,rej)=>{
        DB.find(query,options,(err,docs)=>{
            if(err) return rej(err)
            return res(docs)
        })
    })
}

function pInsert(doc) {
    return new Promise((res,rej)=>{
        DB.insert(doc,(err,newDoc)=>{
            if(err) return rej(err)
            return res(newDoc)
        })
    })
}

function saveModule(module) {
    return Promise.resolve(null).then(() => {
        module.type = 'module'
        module.timestamp = Date.now()
        const manifest = module.manifest
        delete module.manifest
        module.animpath = `anim_${Math.random()}_.json`
        const apath = path.join(ANIM_DIR,module.animpath)
        fs.writeFileSync(apath,JSON.stringify(manifest))
        return pInsert(module)
    })
}

function pUpdate(query,doc) {
    return new Promise((res,rej)=>{
        DB.update(query,doc,{returnUpdatedDocs:true},(err,num,newDoc)=>{
            if(err) return rej(err)
            return res(newDoc)
        })
    })
}

function findAllModules() {
    return new Promise((res,rej)=>{
        DB.find({type:'module', $not:{archived:true}})
            .sort({timestamp:-1})
            .projection({javascript:0, json:0, manifest:0})
            .exec((err,docs)=>{
                if(err) return rej(err)
                return res(docs)
            })
    })
}

function findModuleByIdCompact(id) {
    return new Promise((res,rej)=>{
        DB.find({_id:id})
            .projection({javascript:0, json:0, manifest:0})
            .exec((err,docs)=>{
                if(err) return rej(err)
                return res(docs[0])
            })
    })
}

function getFullModuleById(id) {
    return new Promise((res,rej)=>{
        DB.find({_id:id})
            .exec((err,docs)=>{
                if(err) return rej(err)
                const mod = docs[0]
                mod.manifest = JSON.parse(fs.readFileSync(path.join(ANIM_DIR,mod.animpath)).toString())
                return res(mod)
            })
    })
}

function pUpdateFields(query, fields) {
    return new Promise((res,rej)=>{
        DB.update(query,
            {$set:fields},
            {returnUpdatedDocs:true},
            (err,num,docs)=>{
                if(err) return rej(err)
                console.log("num updated",num)
                return res(docs)
            })
    })
}



function setupServer() {
    //get full info of a particular module
    app.post('/api/modules/archive/:id', checkAdminAuth, (req,res)=>{
        pUpdateFields({_id:req.params.id},{archived:true}).then((doc)=>{
            console.log("successfully archived it",doc)
            res.json({success:true, doc:doc})
        })
    })
    app.get('/api/modules/:id', (req,res) =>
        getFullModuleById(req.params.id)
            .then(mod => res.json({success:true, doc:mod}))
            .catch(e => {
                console.log("error getting full module by id",e)
                res.json({success:false, error:e})
            })
    )
    //list all modules, sorted by name, without the code
    app.get('/api/modules/', (req,res) =>
        findAllModules()
            .then(docs=>res.json(docs))
            .catch(e => {
                console.log("/api/modules error",e)
                res.json({success:false, error:e})
            })
    )
    //mark a particular item in the queue as completed
    app.post('/api/queue/complete/:id', (req,res)=>{
        console.log("trying to complete", req.params.id)
        pUpdateFields({_id:req.params.id},{completed:true}).then((doc)=> {
            console.log("successfully completed it", doc)
            return pFind({type: 'queue'})
        })
            .then((queues)=> {
                const queue = queues[0]
                console.log("old queue count",queue.modules)
                queue.modules = queue.modules.filter(mod=>mod !== req.params.id)
                console.log("new queue count", queue.modules)
                pUpdate({type:'queue'},queue)
                    .then(queue => res.json({success:true, queue:queue}))
            })
    })
    //return the queue object which lists ids of
    app.get('/api/queue/',(req,res) =>
        pFind({type:'queue'})
            .then((queues)=>{
                const queue = queues[0]
                return Promise.all(queue.modules.map(id=>findModuleByIdCompact(id)))
                    .then(modules=>{
                        queue.expanded = modules
                        queue.expanded = queue.expanded.filter(mod => !mod.completed)
                        res.json({success:true, queue:queue})
                    })
            }).catch((e)=>{
            console.log("/api/queue error",e)
            res.json({success:false, error:e})
        })
    )

    app.post('/api/publish/', checkAuth, (req,res)=>{
        saveModule(req.body)
            .then(doc => res.json({success:true, doc:doc}))
            .catch(e => {
                console.log("error inside save module",e)
                res.json({success:false, error:e})
            })
    })

    /*
    app.get('/api/github/login', (req,res)=>{
        const url = `https://github.com/login/oauth/authorize?client_id=${SECRETS.GITHUB_CLIENT_ID}&redirect_uri=${SECRETS.GITHUB_CALLBACK_URL}`
        console.log("requesting github login with url", url)
        res.json({action:'open-window', url:url})
    })

    app.get('/api/github/callback',
        passport.authenticate('github', {session:false}),
        (req,res) => {
            console.log("successfully authenticated from github")
            res.send(`<html>
<body>
    <p>great. you are authenticated. you may close this window now.</p>
    <script>
        document.body.onload = function() {
            const injectedUser = ${JSON.stringify(req.user)}
            console.log("the user is",injectedUser)
            const msg = {payload:injectedUser, status:'success'}
            console.log("msg",msg)
            console.log('location',window.opener.location,'*')
            window.opener.postMessage(msg, '*')
            console.log("done popsting a message")
        }
</script>
</body>
</html>`)
        })
        */

    /*
    app.get('/api/userinfo', (req,res) => {
        const user = USERS[req.query.accesstoken]
        if(user) {
            user.admin = (ADMIN_USERS.indexOf(user.username) >= 0)
            return res.json({success:true,user:user})
        }
        res.json({success:false,message:"no user found with access token"+req.query.accesstoken})
    })

    app.post('/api/updatequeue', checkAdminAuth, (req,res) => {
        pFind({type:'queue'})
            .then((queues)=> {
                const queue = queues[0]
                queue.modules = req.body
                pUpdate({type:'queue'},queue)
                    .then(queue => res.json({success:true, queue:queue}))
            })
    })
*/
}

