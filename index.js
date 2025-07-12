require('dotenv').config()
const express = require('express')
const cors = require('cors')
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const app = express()
const { MongoClient, ServerApiVersion } = require('mongodb');
const port = process.env.PORT || 3000;

// cloudinary upload 
const upload = multer({ storage: multer.memoryStorage() });

// middleware 
app.use(cors())
app.use(express.json())

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
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        // cloudinary image upload 


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