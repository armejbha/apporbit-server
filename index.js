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
    const reviewsCollection = db.collection('reviews');
    const reportsCollection = db.collection('reports');
    const couponsCollection = db.collection('coupons')

    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();



        const verifyAdmin = async (req, res, next) => {
            const email = req?.decoded?.email
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
            const email = req?.decoded?.email
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
                const result = await appsCollection
                    .find()
                    .sort({ status: 1 }) // pending first
                    .toArray();

                const total = result.length;

                res.send({
                    data: result,
                    total,
                });
            } catch (error) {
                console.error('Error fetching all apps:', error);
                res.status(500).send({ message: 'Failed to fetch all apps' });
            }
        });


        app.get('/apps/paginated', async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 6;
                const search = req.query.search || "";

                // Search: match any tag that contains the search term (case-insensitive)
                const query = search
                    ? { tags: { $elemMatch: { $regex: search, $options: 'i' } } }
                    : {};

                const total = await appsCollection.countDocuments(query);
                const totalPages = Math.ceil(total / limit);

                const data = await appsCollection
                    .find(query)
                    .sort({ status: 1 }) // Optional: sort pending apps first
                    .skip((page - 1) * limit)
                    .limit(limit)
                    .toArray();

                res.send({ data, total, totalPages });
            } catch (error) {
                console.error("Error fetching paginated apps:", error);
                res.status(500).send({ message: "Failed to fetch apps" });
            }
        });


        // PATCH /apps/feature/:id
        app.patch('/apps/feature/:id', verifiedToken, verifyModerator, async (req, res) => {
            const { id } = req.params;
            const result = await appsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { isFeatured: true } }
            );
            res.send(result);
        });

        // PATCH /apps/status/:id
        app.patch('/apps/status/:id', verifiedToken, verifyModerator, async (req, res) => {
            const { id } = req.params;
            const { status } = req.body;
            const result = await appsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { status } }
            );
            res.send(result);
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

        // get apps by id 
        app.get('/appsDetails/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const result = await appsCollection.findOne({ _id: new ObjectId(id) });
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: 'Failed to fetch app', error });
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
            console.log(appId, userEmail)

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

        // review save to data base 

        app.post("/reviews", verifiedToken, async (req, res) => {
            try {
                const reviewData = req.body;
                reviewData.createdAt = new Date();

                const result = await reviewsCollection.insertOne(reviewData);

                res.status(201).send({
                    message: "Review submitted successfully",
                    insertedId: result.insertedId,
                });
            } catch (error) {
                res.status(500).send({ message: "Failed to submit review", error });
            }
        });

        // get review by product 
        app.get("/reviews", async (req, res) => {
            try {
                const productId = req.query.productId;

                if (!productId) {
                    return res.status(400).send({ message: "productId is required" });
                }

                const reviews = await reviewsCollection
                    .find({ productId })
                    .sort({ createdAt: -1 }) // newest first
                    .toArray();

                res.send(reviews);
            } catch (error) {
                res.status(500).send({ message: "Failed to fetch reviews", error });
            }
        });

        // save reported data 
        app.post("/reports", verifiedToken, async (req, res) => {
            try {
                const { appId, userEmail, productName } = req.body;

                if (!appId || !userEmail) {
                    return res.status(400).send({ message: "appId and userEmail are required" });
                }

                // Check for duplicate report
                const exists = await reportsCollection.findOne({ appId, userEmail });
                if (exists) {
                    return res.status(409).send({ message: "You have already reported this product." });
                }

                const report = {
                    productName,
                    appId,
                    userEmail,
                    createdAt: new Date()
                };

                await reportsCollection.insertOne(report);
                res.send({ message: "Report submitted successfully." });
            } catch (error) {
                res.status(500).send({ message: "Failed to report", error });
            }
        });

        // get reported data uniquely 

        app.get("/reports", async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 10;
                const skip = (page - 1) * limit;

                // Pipeline to get paginated reports with app details
                const pipeline = [
                    { $sort: { createdAt: -1 } },
                    {
                        $group: {
                            _id: "$appId",
                            report: { $first: "$$ROOT" },
                        },
                    },
                    { $replaceRoot: { newRoot: "$report" } },
                    {
                        $addFields: {
                            appId: { $toObjectId: "$appId" },  // convert string appId to ObjectId
                        },
                    },
                    {
                        $lookup: {
                            from: "apps",
                            localField: "appId",
                            foreignField: "_id",
                            as: "app",
                        },
                    },
                    {
                        $unwind: {
                            path: "$app",
                            preserveNullAndEmptyArrays: true,
                        },
                    },
                    { $skip: skip },
                    { $limit: limit },
                ];

                // Use aggregation to count unique appId values
                const uniqueCountResult = await reportsCollection.aggregate([
                    { $group: { _id: "$appId" } },
                    { $count: "totalUnique" }
                ]).toArray();

                const total = uniqueCountResult.length > 0 ? uniqueCountResult[0].totalUnique : 0;

                // Fetch paginated reports with apps info
                const result = await reportsCollection.aggregate(pipeline).toArray();

                res.send({
                    total,
                    page,
                    limit,
                    totalPages: Math.ceil(total / limit),
                    data: result,
                });
            } catch (error) {
                console.error("Error in GET /reports:", error);
                res.status(500).send({ message: "Server error", error });
            }
        });

        // delete data form database 
        // DELETE /reports/:id
        app.delete('/reports/:id', verifiedToken, verifyModerator, async (req, res) => {
            const { id } = req.params;
            console.log(id);
            try {
                const result = await reportsCollection.deleteOne({ _id: new ObjectId(id) });
                console.log(result);
                if (result.deletedCount > 0) {
                    res.send({ success: true, result });

                } else {
                    res.status(404).send({ success: false, message: 'Report not found' });
                }
            } catch (error) {
                res.status(500).send({ success: false, message: 'Failed to delete report' });
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

        // get all user role  
        app.get("/users", verifiedToken, verifyAdmin, async (req, res) => {
            try {
                const page = parseInt(req.query.page) || 1;
                const limit = parseInt(req.query.limit) || 10;
                const skip = (page - 1) * limit;

                // Filter: exclude admin users
                const filter = { role: { $ne: "admin" } };

                // Get total count of non-admin users
                const total = await usersCollection.countDocuments(filter);

                // Get paginated users (non-admin)
                const users = await usersCollection
                    .find(filter)
                    .skip(skip)
                    .limit(limit)
                    .toArray();

                res.send({
                    total,
                    page,
                    totalPages: Math.ceil(total / limit),
                    users,
                });
                console.log(users);
            } catch (error) {
                console.error("Failed to fetch users:", error);
                res.status(500).send({ message: "Failed to fetch users", error });
            }
        });

        // update user role by id 
        // PATCH: Update user role
        app.patch("/users/role/:id", verifiedToken, verifyAdmin, async (req, res) => {
            const userId = req.params.id;
            const { role } = req.body;

            try {
                const user = await usersCollection.findOne({ _id: new ObjectId(userId) });

                if (!user) {
                    return res.status(404).send({ message: "User not found" });
                }

                if (user.role === "admin") {
                    return res.status(403).send({ message: "Cannot change role of an admin user" });
                }

                const updateResult = await usersCollection.updateOne(
                    { _id: new ObjectId(userId) },
                    { $set: { role } }
                );

                res.send({
                    message: "Role updated successfully",
                    result: updateResult,
                });
            } catch (error) {
                console.error("Role update failed", error);
                res.status(500).send({ message: "Internal Server Error", error });
            }
        });

        //  coupons 

        // get all coupons 
        app.get("/admin/coupons", verifiedToken, verifyAdmin, async (req, res) => {
            const coupons = await couponsCollection.find().sort({ expiryDate: 1 }).toArray();
            res.send(coupons);
        });

        // create a coupons 
        app.post("/admin/coupons", verifiedToken, verifyAdmin, async (req, res) => {
            const coupon = req.body;
            try {
                const result = await couponsCollection.insertOne(coupon);
                res.send(result);
            } catch {
                res.status(500).send({ error: "Insert failed" });
            }
        });

        // update code 
        app.patch("/admin/coupons/:id", verifiedToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;

            const updateData = req.body;
            console.log(updateData, id)
            try {
                const result = await couponsCollection.updateOne(
                    { _id: new ObjectId(id) },
                    { $set: updateData }
                );
                console.log(result);
                if (result.modifiedCount > 0) {
                    res.send({ success: true, message: "Coupon updated successfully." });
                } else {
                    res.status(404).send({ success: false, message: "No matching coupon found." });
                }
            } catch (error) {
                console.error("Error updating coupon:", error);
                res.status(500).send({ success: false, error: "Internal Server Error" });
            }
        });

        // delete token 
        app.delete("/admin/coupons/:id", verifiedToken, verifyAdmin, async (req, res) => {
            const { id } = req.params;
            try {
                const result = await couponsCollection.deleteOne({ _id: new ObjectId(id) });
                res.send(result);
            } catch (error) {
                res.status(500).send({ error: "Failed to delete coupon" });
            }
        });

        // get valid coupons 
        app.get("/coupons", async (req, res) => {
            const today = new Date().toISOString();
            const coupons = await couponsCollection
                .find({ isActive: true, expiryDate: { $gt: today } })
                .sort({ expiryDate: 1 })
                .toArray();
            res.send(coupons);
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