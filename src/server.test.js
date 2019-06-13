const request = require('supertest')
const express = require('express')
const server = require('./server')
const assert = require('assert')
const fs = require('fs')
const path = require('path')


function p_mkdir(fname) {
    return new Promise((res,rej)=>{
        fs.exists(fname,(exists)=> {
            if(exists) return res()
            fs.mkdir(fname, (err, ans) => {
                if (err) return rej(err)
                res()
            })
        })
    })
}

async function p_rmdir(dir) {
    const info = await fs.promises.stat(dir)
    if(info.isDirectory()) {
        const list = await fs.promises.readdir(dir)
        if (list.length === 0) {
            console.log(`deleting ${dir}`)
            return fs.promises.rmdir(dir)
        } else {
            const proms = list.map(name=> p_rmdir(path.join(dir,name)))
            return Promise.all(proms)
        }
    }

    console.log(`deleting ${dir}`)
    await fs.promises.unlink(dir)
}

function pass(msg) {
    console.log("   PASSED:",msg)
}


async function fileOrDirectoryExists(filepath) {
    return fs.promises.access(filepath).then(()=>true).catch(()=>false)
}

async function doit() {
    await p_rmdir('testdir')
    await p_mkdir('testdir')
    await p_mkdir('testdir/docs')
    await p_mkdir('testdir/assets')
    await p_mkdir('testdir/scripts')
    const app = server.startServer({
        DIR:"testdir",
        TEST_AUTH: true
    })


    //get server info. proves we can connect
    await request(app).get('/info')
        .expect('Content-Type', /json/)
        .expect(200)
        .then(res => {
            assert(res.body.authentication, 'auth is not-supported')
        })


    //log in as user 1
    const accessKey = await request(app).post(`/auth/testlogin/user1`)
        .expect('Content-Type', /json/)
        .expect(200)
        .then(res => {
            // console.log("tried to log in",res.body)
            assert(res.body['access-key'])
            return res.body['access-key']
        })

    console.log(`using the user1 login key of '${accessKey}'`)


    //get a doc, it shouldn't succeed
    await request(app).get(`/user1/doc/testdoc1`)
        .set('access-key',accessKey)
        .expect('Content-Type', /json/)
        .expect(200)
        .then(res => {
            assert(res.body.success === false,"this shouldn't have succeeded")
        })
        .then(()=>pass("get missing doc test"))

    //list the dir,should be empty
    await request(app).get(`/user1/doc/list`)
        .set('access-key',accessKey)
        .expect('Content-Type', /json/)
        .expect(200)
        .then(res => {
            assert(res.body.length === 0)
        })
        .then(()=>pass("doc list test"))

    //test making a doc
    await request(app)
        .post('/user1/doc/testdoc1?type=test&title=testdoc1_title')
        .set('access-key',accessKey)
        .send({foo:"bar"})
        .expect('Content-Type', /json/)
        .expect(200)
        .then(res => {
            console.log("return is",res.body)
            assert(res.body.doc.type === 'test')
            assert(res.body.doc.title === 'testdoc1_title')
        })
        .then(()=>pass("make doc test"))

    //now list the dir
    await request(app).get(`/user1/doc/list`)
        .set('access-key',accessKey)
        .expect('Content-Type', /json/)
        .expect(200)
        .then(res => {
            assert(res.body.length === 1)
        })
        .then(()=>pass("doc list test"))

    //try to access the doc, should succeed
    await request(app).get(`/user1/doc/testdoc1`)
        .set('access-key',accessKey)
        .expect('Content-Type', /json/)
        .expect(200)
        .then(res => {
            assert(res.body.success)
            assert(res.body.foo === 'bar')
        })
        .then(()=>pass("get my own doc test"))

    //now switch users
    const loginkey2 = await request(app).post(`/auth/testlogin/user2`)
        .expect('Content-Type', /json/)
        .expect(200)
        .then(res => {
            assert(res.body['access-key'])
            return res.body['access-key']
        })

    //try to list the dir, should fail
    await request(app).get(`/user1/doc/list`)
        .set('access-key',loginkey2)
        .expect('Content-Type', /json/)
        .expect(403)
        .then(res => {
            assert(res.body.success === false)
        })
        .then(()=>pass("doc list test"))



    //try to access the doc, should succeed
    await request(app).get(`/user1/doc/testdoc1`)
        .set('access-key',loginkey2)
        .expect('Content-Type', /json/)
        .expect(200)
        .then(res => {
            assert(res.body.success)
            assert(res.body.foo === 'bar')
        })
        .then(()=>pass("get other user doc test"))

    //try to delete the doc, should fail
    await request(app).post('/user1/doc/delete/testdoc1/')
        .set('access-key',loginkey2)
        .expect('Content-Type', /json/)
        .expect(403)
        .then(res => {
            assert(res.body.success === false)
        })
        .then(()=>pass("delete other user doc test"))

    //now switch back to user1

    //delete the doc
    await request(app).post('/user1/doc/delete/testdoc1/')
        .set('access-key',accessKey)
        .expect('Content-Type', /json/)
        .expect(200)
        .then(res => {
            assert(res.body.success === true)
        })
        .then(()=>pass("delete my doc test"))

    //now list, should be 0
    await request(app).get(`/user1/doc/list`)
        .set('access-key',accessKey)
        .expect('Content-Type', /json/)
        .expect(200)
        .then(res => {
            assert(res.body.length === 0)
        })
        .then(()=>console.log("passed: doc list test"))


    // assert(fileOrDirectoryExists('testdir/docs/user1') === true)
    // assert(fileOrDirectoryExists('testdir/user2') === true)
    // assert(fileOrDirectoryExists('testdir/blah') === false)

    //list assets
    await request(app).get(`/user1/asset/list`)
        .set('access-key',accessKey)
        .then(res => {
            assert(res.body.length === 0)
        })
        .then(()=>console.log("passed: doc list test"))
    //upload an asset
    await request(app).post('/user1/asset/foobarbaz.gif')
    //list assets
    //try to get asset as another user
    //try to upload asset as another user
    //try to delete the asset as another user
    //delete the asset



    console.log("done with it all")

}

doit()