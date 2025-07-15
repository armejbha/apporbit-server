require('dotenv').config()
const express = require('express')
const cors = require('cors')
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const app = express()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 3000;
const admin = require("firebase-admin");
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);

// cloudinary upload 
const upload = multer({ storage: multer.memoryStorage() });

// middleware 
const corsOptions = {
    origin: ['http://localhost:5173', 'http://localhost:5174'],
    credentials: true,
    optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())

// token verified 
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});


const verifiedToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).send({ message: 'unauthorize access' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded
        next()
    } catch (error) {
        return res.status(403).send({ message: 'forbidden access' })
    }

}


const uri = `mongodb+srv://${process.env.MONGO_USER}:${process.env.MONGO_PASS}@cluster.3ful3ka.mongodb.net/?retryWrites=true&w=majority&appName=Cluster`;


// cloudinary config 
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

// cloudinary file upload api 
app.post('/upload', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send({ message: 'No file uploaded' });

        const fileBuffer = req.file.buffer;

        // Upload from buffer using stream
        const streamUpload = (buffer) => {
            return new Promise((resolve, reject) => {
                const stream = cloudinary.uploader.upload_stream(
                    { folder: 'your-folder-name' }, // optional folder
                    (error, result) => {
                        if (result) resolve(result);
                        else reject(error);
                    }
                );
                stream.end(buffer);
            });
        };

        const result = await streamUpload(fileBuffer);

        res.send({ secure_url: result.secure_url, public_id: result.public_id });

    }
    catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Cloudinary upload failed', error });
    }
});


async function run() {


    // database created 
    const db = client.db('appdb');
    const appsCollection = db.collection('apps');
    const usersCollection = db.collection('users');

    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();



        const verifyAdmin = async (req, res, next) => {
            const email = req?.user?.email
            const user = await usersCollection.findOne({
                email,
            })
            console.log(user?.role)
            if (!user || user?.role !== 'admin')
                return res
                    .status(403)
                    .send({ message: 'Admin only Actions!', role: user?.role })

            next()
        }

        const verifyModerator = async (req, res, next) => {
            const email = req?.user?.email
            const user = await usersCollection.findOne({
                email,
            })
            console.log(user?.role)
            if (!user || user?.role !== 'moderator')
                return res
                    .status(403)
                    .send({ message: 'Moderator only Actions!', role: user?.role })

            next()
        }



        // post apps data 

        app.post('/add-apps', verifiedToken, async (req, res) => {
            try {
                const appData = req.body;

                const result = await appsCollection.insertOne(appData);
                res.status(201).send({ message: 'App added successfully', insertedId: result.insertedId });
            } catch (error) {
                console.error('Error adding app:', error);
                res.status(500).send({ message: 'Internal server error' });
            }
        });

        // get all apps 
        app.get('/apps', async (req, res) => {
            try {
                const result = await appsCollection.find().toArray();
                res.send(result);
            } catch (error) {
                console.error('Error fetching products:', error);
                res.status(500).send({ message: 'Failed to fetch products' });
            }
        });

        // get apps for specific user 
        app.get('/apps/user', verifiedToken, async (req, res) => {
            try {
                const { email, page = 1, limit = 10 } = req.query;

                if (req.decoded.email !== email) {
                    return res.status(403).send({ message: 'Forbidden access' });
                }

                const query = { 'owner.email': email };

                const pageInt = parseInt(page);
                const limitInt = parseInt(limit);

                const total = await appsCollection.countDocuments(query);

                const data = await appsCollection
                    .find(query)
                    .sort({ createdAt: -1 })
                    .skip((pageInt - 1) * limitInt)
                    .limit(limitInt)
                    .toArray();

                res.status(200).send({
                    data,
                    total,
                });
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Server Error' });
            }
        });

        // upadate apps data 

        app.patch('/apps/:id', verifiedToken, async (req, res) => {
            try {
                const { id } = req.params;
                const updatedData = req.body;

                const filter = { _id: new ObjectId(id) };
                const updateDoc = {
                    $set: {
                        name: updatedData.name,
                        title: updatedData.title,
                        website: updatedData.website,
                        description: updatedData.description,
                        tags: updatedData.tags,
                        image: updatedData.image,
                        owner: {
                            name: updatedData.ownerName,
                            email: updatedData.ownerEmail,
                            image: updatedData.ownerPhoto,
                        }
                    }
                };

                const result = await appsCollection.updateOne(filter, updateDoc);

                if (result.modifiedCount > 0) {
                    res.status(200).send({ success: true, message: 'App updated successfully' });
                } else {
                    res.status(404).send({ success: false, message: 'No app found or nothing was updated' });
                }
            } catch (error) {
                console.error('Update error:', error);
                res.status(500).send({ success: false, message: 'Server error' });
            }
        });

        // deleted a apps data 
        app.delete('/apps/:id', async (req, res) => {
            const id = req.params.id;
            try {
                const result = await appsCollection.deleteOne({ _id: new ObjectId(id) });
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to delete the app' });
            }
        });

        // upvote apps 
        app.patch('/apps/upvote/:id', verifiedToken, async (req, res) => {
            const userEmail = req.body.user;
            const appId = req.params.id;

            if (!userEmail) {
                return res.status(400).send({ message: 'User email is required' });
            }

            try {
                const appDoc = await appsCollection.findOne({ _id: new ObjectId(appId) });
                if (!appDoc) {
                    return res.status(404).send({ message: 'App not found' });
                }

                // Prevent owner voting
                if (userEmail === appDoc.owner.email) {
                    return res.status(403).send({ message: 'Owner cannot vote on own app' });
                }

                // Check if user already voted
                if (appDoc.voters && appDoc.voters.includes(userEmail)) {
                    return res.status(400).send({ message: 'User already voted' });
                }

                // Update: increment votes, add user to voters array
                const result = await appsCollection.updateOne(
                    { _id: new ObjectId(appId) },
                    {
                        $inc: { upvotes: 1 },
                        $push: { voters: userEmail },
                    }
                );

                if (result.modifiedCount === 1) {
                    return res.send({ message: 'Upvote successful' });
                } else {
                    return res.status(500).send({ message: 'Failed to upvote' });
                }
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Server error' });
            }
        });

        // undo upvote apps 
        app.patch('/apps/undo-upvote/:id', verifiedToken, async (req, res) => {
            const userEmail = req.body.user;
            const appId = req.params.id;

            if (!userEmail) {
                return res.status(400).send({ message: 'User email is required' });
            }

            try {
                const appDoc = await appsCollection.findOne({ _id: new ObjectId(appId) });
                if (!appDoc) {
                    return res.status(404).send({ message: 'App not found' });
                }

                if (!appDoc.voters || !appDoc.voters.includes(userEmail)) {
                    return res.status(400).send({ message: 'User has not voted yet' });
                }

                // Update: decrement votes, remove user from voters array
                const result = await appsCollection.updateOne(
                    { _id: new ObjectId(appId) },
                    {
                        $inc: { upvotes: -1 },
                        $pull: { voters: userEmail },
                    }
                );

                if (result.modifiedCount === 1) {
                    return res.send({ message: 'Undo upvote successful' });
                } else {
                    return res.status(500).send({ message: 'Failed to undo upvote' });
                }
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: 'Server error' });
            }
        });



        // inserted user to database
        app.post('/user', async (req, res) => {
            const userData = req.body
            userData.role = 'user'
            userData.created_at = new Date().toISOString()
            userData.last_loggedIn = new Date().toISOString()
            const query = {
                email: userData?.email,
            }
            const alreadyExists = await usersCollection.findOne(query)
            if (!!alreadyExists) {

                const result = await usersCollection.updateOne(query, {
                    $set: { last_loggedIn: new Date().toISOString() },
                })
                return res.send(result)
            }

            // return console.log(userData)
            const result = await usersCollection.insertOne(userData)
            res.send(result)
        })

        // get user role from database 
        app.get('/user/role/:email', verifiedToken, async (req, res) => {
            const email = req.params.email
            const result = await usersCollection.findOne({ email })
            if (!result) return res.status(404).send({ message: 'User Not Found.' })
            res.send({ role: result?.role })
        })
        // update user info data 
        // PATCH /users/:email
        app.patch('/users/:email', verifiedToken, async (req, res) => {
            const email = req.params.email;
            const updatedData = req.body;

            const result = await usersCollection.updateOne(
                { email },
                { $set: updatedData }
            );

            res.send(result);
        });




        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } catch (error) {
        console.error("Connection Failed", error)
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send("AppOrbit server is running")
})
app.listen(port, () => {
    console.log(`Server is running by${port}`)
})