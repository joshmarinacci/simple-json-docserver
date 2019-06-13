console.log("starting the json doc server")

let CONFIG = null
const cors = require('cors')
const bodyParser = require('body-parser')
const fs = require('fs')
const express = require('express')
const path = require('path')
const NEDB = require('nedb')
const passport = require('passport')
const GithubStrategy = require('passport-github')

const USERS = {}
let DB = null
const GUEST_USER = {
    username:'guest'
}
function checkAuth(req,res,next) {
    if(CONFIG.SKIP_AUTH) {
        req.username = 'joshmarinacci'
        return next()
    }
    // if(CONFIG.INSECURE_AUTH===true) {
    //     console.log("params",req.params, req.query)
    //     const token=req.query.accesstoken
    //     req.username = user.username
    //     if(req.user) return next()
    // }
    //if no access key then use the guest user
    if(!req.headers['access-key']) {
        console.log("=== using the guest user")
        req.user = GUEST_USER
        req.username = GUEST_USER.username
        return next()
    }
    const token = req.headers['access-key']
    const user = USERS[token]
    if(!user) return res.json({success:false,message:'invalid access token, cannot find user'})
    console.log("the user is",user.username)
    req.user = user
    req.username = req.user.username
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

function calcDocPath(username,id) {
    return path.join(CONFIG.DOCS_DIR,username,id+'.json')
}

function loadJSONDocument(id,username) {
    // console.log("Loading a doc with",id,'for username',username)
    return findDocMeta({id:id}).then(infos=>{
        if(infos.length < 1) throw new Error(`no such document for id ${id} for username '${username}`)
        console.log("the doc count is",infos.length)
        console.log(infos)
        return JSON.parse(fs.readFileSync(calcDocPath(username,infos[0].id)).toString())
    })
}

function makeDirExist(fname) {
    if(!fs.existsSync(fname)) fs.mkdirSync(fname)
}

function saveJSONDocument(id, doc, username, query) {
    //save the body data to a json file
    //create a unique doc id if none is specified
    //add metadata to database
    return Promise.resolve(null).then(() => {
        // console.log("saving the json doc",doc)
        // console.log("using query",query)
        // console.log("with username",username)
        if(!doc) throw new Error("missing document body")
        if(!query.type) throw new Error("missing doc type")
        const meta = {
            kind:'doc',
            id:"id"+Math.floor(Math.random()*10000000),
            timestamp: Date.now(),
            username:username,
            type:query.type,
            title:query.title,
        }
        if(id) meta.id = id

        makeDirExist(path.join(CONFIG.DOCS_DIR,username))
        // const doc_path = path.join(CONFIG.DOCS_DIR,meta.id+'.json')
        const doc_path = calcDocPath(username,meta.id)
        // console.log('saving',meta,'to',doc_path)
        fs.writeFileSync(doc_path, JSON.stringify(doc))
        return docInsert(meta)
    })
}

const MIMETYPES = {
    'png':'image/png',
    'jpg':'image/jpeg',
    'jpeg':'image/jpeg',
    'gif':'image/gif',
    'm4a':'audio/aac',
    'mp4':'video/mp4',
    'mp3':'audio/mpeg',
    'js':'text/javascript',
    'glb':'model/gltf-binary',
    'gltf':'model/gltf+json',
}

function calcAssetPath(username, id, ext) {
    return path.join(CONFIG.ASSETS_DIR,username,id,'.',ext)
}

function saveAsset(req) {
    return new Promise((res,rej)=>{
        const ext = req.params.id.substring(req.params.id.lastIndexOf('.')+1).toLowerCase()
        console.log("got request to upload an asset with id",req.params.id, 'extension',ext)
        const mimetype = MIMETYPES[ext]
        console.log("mimetype",mimetype)
        if(!mimetype) throw new Error(`unknown mimetype for extension ${ext}`)
        const id = "asset"+Math.floor(Math.random()*10000000)
        const fpath = calcAssetPath(req.params.username,id,ext)
        // const fpath = path.join(CONFIG.ASSETS_DIR,id+'.'+ext)
        console.log("writing to disk as",fpath)
        const file = fs.createWriteStream(fpath,{encoding:'binary'})
        //stream it directly to disk
        req.on('data',(chunk) => file.write(chunk))
        req.on('end', () => {
            file.end()
            const meta = {
                kind:'asset',
                id:id,
                timestamp: Date.now(),
                username:req.username,
                mimeType:mimetype,
                extension:ext,
                title:req.params.id,
            }
            console.log("done uploading. meta is",meta)
            docInsert(meta).then(()=>{
                console.log("done inserting")
                res(meta)
            })
        })

    })
}

function parseScriptMetadata(fpath) {
    return new Promise((res,rej) => {
        fs.readFile(fpath,(err,data)=>{
            const meta = {
                title:null,
                description:null,
            }
            if(!data) return res(meta)
            const contents = data.toString()
            console.log("scanning",contents)
            const title = contents.match(/\#title(.*)/)
            console.log("match",title)
            if(title) meta.title = title[1]
            const desc = contents.match(/\#description(.*)/)
            console.log("match",desc)
            if(desc) meta.description = desc[1]
            res(meta)
        })
    })
}

function deleteScript(req) {
    console.log("deleting script",req.params.name)
    const fpath = calcScriptPath(req.params.username, req.params.name)
    fs.unlinkSync(fpath)
    return new Promise((res,rej)=>{
        DB.remove({kind:'script',name:req.params.name, username:req.username},{},(err, numRemoved)=>{
            if(err) {
                console.warn("error removing " + fpath)
                rej(err)
            }
            console.log("removed",numRemoved)
            res()
        })
    })
    // return deleteDoc({kind:'script',name:req.params.name,username:req.username})
}

function deleteAsset(req, assets) {
    console.log("deleting asset",req.params.id, assets)
    return assets.map(asset => {
        if(!asset.extension) {
            if(asset.mimeType === MIMETYPES.png) asset.extension = 'png'
        }
        const fpath = calcAssetPath(req.params.username,req.params.id,asset.extension)
        console.log('trying to delete the path',fpath)
        fs.unlinkSync(fpath)
        return new Promise((res,rej)=>{
            DB.remove({kind:'asset',id:req.params.id, username:req.username},{},(err, numRemoved)=>{
                if(err) {
                    console.warn("error removing " + fpath)
                    rej(err)
                }
                console.log("removed",numRemoved)
                res()
            })
        })
    })
}

function deleteDocs(req,docs) {
    console.log("deleting docs",req.params.id,docs)
    return docs.map(doc => {
        const fpath = calcDocPath(req.params.username,req.params.id)
        console.log("trying to delete",doc,fpath)
        fs.unlinkSync(fpath)
        return new Promise((res,rej)=>{
            DB.remove({kind:'doc',id:req.params.id, username:req.username},{},(err, numRemoved)=>{
                if(err) {
                    console.warn("error removing " + fpath)
                    rej(err)
                }
                console.log("removed",numRemoved)
                res()
            })
        })
    })
}

function calcScriptPath(username, name) {
    return path.join(CONFIG.SCRIPTS_DIR,username,name)
}

function upsertScript(req) {
    return new Promise((res,rej)=>{
        console.log("got a request to add as script with name",req.params.name)
        const fpath = calcScriptPath(req.params.username,req.params.name)
        console.log("saving to ",fpath)
        const file = fs.createWriteStream(fpath)
        req.on('data',(chunk) => file.write(chunk))
        req.on('end', () => {
            file.end()
            return parseScriptMetadata(fpath).then(meta => {
                console.log("the meta is",meta)
            return findDocMeta({kind:'script',name:req.params.name, username:req.username})
                .then((scripts)=>{
                    if(scripts.length < 1) {
                        console.log("script does not exist yet, must add it")
                        const info = {
                            kind:'script',
                            timestamp: Date.now(),
                            username:req.username,
                            name:req.params.name,
                            title:meta.title?meta.title:'untitled',
                            description:meta.description,
                        }
                        return docInsert(info).then(()=>{
                            console.log("inserted script at",fpath)
                            res(info)
                        })
                    } else {
                        console.log("got the meta",meta)
                        return new Promise((res2,rej)=>{
                            DB.update({name:req.params.name, username:req.username},
                                {$set:meta},
                                {returnUpdatedDocs:true},(err,num,newDoc)=>{
                                console.log("error",err)
                                    console.log("num",num)
                                    console.log("new doc",newDoc)
                                    if(err) return rej(err)
                                    console.log("updated script at",fpath,newDoc)
                                    return res2(newDoc)
                                })
                        }).then((nd)=>{
                            res(nd)
                        })
                    }
                })

            })
        })
    })
}

function findDocMeta(query,options) {
    return new Promise((res,rej)=>{
        DB.find(query,options,(err,docs)=>{
            if(err) return rej(err)
            return res(docs)
        })
    })
}
function docUpdate(meta) {
    return new Promise((res,rej)=>{
        DB.update({id:meta.id, username:meta.username},meta,{returnUpdatedDocs:true},(err,num,newDoc)=>{
            if(err) return rej(err)
            return res(newDoc)
        })
    })
}
function docInsert(meta) {
    return findDocMeta({id:meta.id,username:meta.username})
        .then((found)=>{
            if(found.length > 0) {
                console.log("this doc already exists. need to overwrite it instead")
                return docUpdate(meta)
            } else {
                console.log("doing a real doc insert")
                return realMetaInsert(meta)
            }
        })
}
function authTemplate(req) {
    return `<html>
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
    </html>`
}

function realMetaInsert(meta) {
    return new Promise((res,rej)=>{
        DB.insert(meta,(err,newDoc)=>{
            if(err) return rej(err)
            return res(newDoc)
        })
    })
}


function generateTestingLogin(username) {
    const token = `token-${Math.floor(Math.random()*100000)}`
    USERS[token] = {
        username:username
    }
    return token
}

function setupRoutes(app) {
    app.get('/info',(req,res)=>{
        return res.json({
            assetUpload:true,
            authentication:true,
            scriptEditing:true,
            docDeleteSupported:true,
        })
    })
    app.get('/auth/github/login', (req,res)=>{
        const url = `https://github.com/login/oauth/authorize?client_id=${CONFIG.GITHUB_CLIENT_ID}&redirect_uri=${CONFIG.GITHUB_CALLBACK_URL}`
        console.log("requesting github login with url", url)
        res.json({action:'open-window', url:url})
    })
    app.get('/auth/github/callback', passport.authenticate('github', {session:false}), (req,res) => {
            console.log("successfully authenticated from github")
            res.send(authTemplate(req))
        })
    app.post('/auth/testlogin/:username',(req,res)=>{
        if(!CONFIG.TEST_AUTH) return res.status(403).json({success:false,message:'test auth not enabled'})
        console.log("doing a fake login of user",req.params.username)
        const accessKey = generateTestingLogin(req.params.username)
        res.json({'access-key': accessKey})
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
    app.get('/:username/userinfo', checkAuth, (req,res) => {
        if(req.username) {
            return res.json({success:true, username:req.username})
        }
        res.json({success:false,message:"no user found with access token"+req.query.accesstoken})
    })
    app.get('/:username/doc/list', checkAuth, (req,res)=>{
        if(req.username !== req.params.username) return res
            .status(403)
            .json({success:false,message:'cannot list another users docs'})
        findDocMeta({username:req.username, kind:'doc'})
            .then(docs => res.json(docs))
    })
    app.post('/:username/doc/delete/:id', checkAuth, (req,res)=>{
        if(req.username !== req.params.username) return res
            .status(403)
            .json({success:false,message:'cannot delete another users docs'})
        findDocMeta({username:req.username,id:req.params.id})
            .then(docs => deleteDocs(req,docs))
            .then(()=> res.json({success:true, script:req.params.id, message:'deleted'}))
            .catch(e => res.json({success:false, message:e.message}))
    })

    app.get('/:username/doc/:id',checkAuth,(req,res)=>{
        // console.log("loading doc for",req.username, req.params.username)
        loadJSONDocument(req.params.id, req.params.username)
            .then(doc => {
                doc.success = true
                res.json(doc)
            })
            .catch(e => res.json({success:false, message:e.message}))
    })
    app.post('/:username/doc/:id', checkAuth, (req,res)=>{
        if(req.username !== req.params.username) return res
            .status(403)
            .json({success:false,message:'cannot save to another users docs'})
        saveJSONDocument(req.params.id,req.body,req.params.username,req.query)
            .then(doc => res.json({success:true, doc:doc, message:'saved'}))
            .catch(e => res.json({success:false, message:e.message}))
    })



    app.get('/:username/asset/list', checkAuth,  (req,res)=>{
        if(req.username !== req.params.username) return res
            .status(403)
            .json({success:false,message:'cannot mess with another users stuff'})
        findDocMeta({username:req.username, kind:'asset'})
            .then(docs => res.json(docs))
    })
    app.post('/:username/asset/delete/:id', checkAuth, (req,res)=>{
        if(req.username !== req.params.username) return res
            .status(403)
            .json({success:false,message:'cannot mess with another users stuff'})
        findDocMeta({kind:'asset',id:req.params.id})
            .then((assets)=> deleteAsset(req,assets))
            .then(()=> res.json({success:true, script:req.params.id, message:'deleted'}))
            .catch(e => res.json({success:false, message:e.message}))
    })
    app.get('/:username/asset/:id', (req,res) => {
        // console.log("searching for",req.params.id)
        findDocMeta({kind:'asset',id:req.params.id}).then((assets)=>{
            if(assets.length < 1) throw new Error(`could not find asset with id ${req.params.id}`)
            const asset = assets[0]
            const filePath = path.join(process.cwd(),CONFIG.ASSETS_DIR,`${asset.id}.${asset.extension}`)
            console.log("returning the file",filePath)
            res.sendFile(filePath)
        })
            .catch(e => res.json({success:false, message:e.message}))
    })
    app.post('/:username/asset/:id',checkAuth, (req,res) => {
        if(req.username !== req.params.username) return res
            .status(403)
            .json({success:false,message:'cannot mess with another users stuff'})
        saveAsset(req)
            .then(asset => res.json({success:true, asset:asset, message:'saved'}))
            .catch(e => res.json({success:false, message:e.message}))
    })



    app.get('/:username/scripts/list', checkAuth,  (req,res) => {
        if(req.username !== req.params.username) return res
            .status(403)
            .json({success:false,message:'cannot mess with another users stuff'})
        findDocMeta({username:req.username, kind:'script'})
            .then(docs => res.json(docs))
            .catch(e => res.json({success:false, message:e.message}))
    })
    app.get('/:username/scripts/:name', (req,res) => {
        findDocMeta({kind:'script',name:req.params.name})
            .then(scripts => {
                if(scripts.length < 1) throw new Error(`could not find script with name ${req.params.name}`)
                const script = scripts[0]
                const filePath = calcScriptPath(req.params.username,script.name)
                res.sendFile(filePath)
            })
            .catch(e => res.json({success:false, message:e.message}))
    })
    app.post('/:username/scripts/delete/:name',checkAuth, (req,res) => {
        if(req.username !== req.params.username) return res
            .status(403)
            .json({success:false,message:'cannot mess with another users stuff'})
        deleteScript(req)
            .then(() => {
                res.json({success:true, script:req.params.name, message:'deleted'})
            })
            .catch(e => res.json({success:false, message:e.message}))
    })
    app.post('/:username/scripts/:name',checkAuth,(req,res) => {
        if(req.username !== req.params.username) return res
            .status(403)
            .json({success:false,message:'cannot mess with another users stuff'})
        upsertScript(req)
            .then(script => {
                console.log("sending hte response",script)
                res.json({success:true, script:script, message:'saved'})
            })
            .catch(e => res.json({success:false, message:e.message}))
    })

}

function startServer(CONFIG_in) {
    CONFIG = CONFIG_in
    //handle args next
    if(!fs.existsSync(CONFIG.DIR)) throw new Error(`dir doesn't exist: "${CONFIG.DIR}"`)
    CONFIG.DOCS_DIR = path.join(CONFIG.DIR,'docs')
    CONFIG.ASSETS_DIR = path.join(CONFIG.DIR,'assets')
    CONFIG.SCRIPTS_DIR = path.join(CONFIG.DIR,'scripts')
    CONFIG.DB_FILE = path.join(CONFIG.DIR,'database.db')
    if(!fs.existsSync(CONFIG.DIR)) throw new Error(`dir doesn't exist: "${CONFIG.DIR}"`)
    if(!fs.existsSync(CONFIG.DOCS_DIR)) throw new Error(`docs dir doesn't exist: "${CONFIG.DOCS_DIR}"`)
    if(!fs.existsSync(CONFIG.ASSETS_DIR)) throw new Error(`docs dir doesn't exist: "${CONFIG.ASSETS_DIR}"`)
    if(!fs.existsSync(CONFIG.SCRIPTS_DIR)) throw new Error(`docs dir doesn't exist: "${CONFIG.SCRIPTS_DIR}"`)
    if(CONFIG.PORT === -1) throw new Error(`missing port number`)


    DB = new NEDB({filename: CONFIG.DB_FILE, autoload:true})
    //create the server
    const app = express()
    //make json formatting of REST APIs be pretty
    app.set("json spaces",4)
    //turn on CORS, Cross Origin Resource Sharing. allow all origins
    app.use(cors({origin:"*"}))
    //assume all bodies will be JSON and parse them automatically
    app.use(bodyParser.json({limit:'20MB'}))

    if(!CONFIG.GITHUB_CLIENT_ID) {
        console.warn("missing GITHUB_CLIENT_ID, auth is disabled")
    } else {
        //setup passport for github auth
        passport.use(new GithubStrategy({
            clientID: CONFIG.GITHUB_CLIENT_ID,
            clientSecret: CONFIG.GITHUB_CLIENT_SECRET,
            callbackURL: CONFIG.GITHUB_CALLBACK_URL
        }, function (accessToken, refreshToken, profile, done) {
            console.log("passport callback")
            //store the user profile in memory by access token
            USERS[accessToken] = profile
            console.log("the user is", USERS[accessToken])
            console.log('access token is', accessToken)
            done(null, {id: profile.id, accessToken: accessToken})
        }))

        app.use(passport.initialize())
    }


    setupRoutes(app)


    app.listen(CONFIG.PORT, () => console.log(`
doc server http://localhost:${CONFIG.PORT}/ 
database  ${CONFIG.DB_FILE}
docs dir ${CONFIG.DOCS_DIR}
assets dir ${CONFIG.ASSETS_DIR}
scripts dir ${CONFIG.SCRIPTS_DIR}
        `))
    return app
}


module.exports.startServer = startServer