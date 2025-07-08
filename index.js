const express = require("express");
const { MongoClient, ServerApiVersion } = require("mongodb");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

//Middleware
app.use(cors());
app.use(express.json());

const uri = process.env.DB_URL;
console.log(uri);
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    await client.connect();
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    const userCollection = client.db("medi-ease").collection("users");

    // insert user data from client side
    app.post("/userInfo", async (req, res) => {
      const userInfo = req.body.userInfo;
      userInfo.createdAt = new Date().toISOString();
      const existing = await userCollection.findOne({ email: userInfo.email });
      if (existing) {
        return res.status(409).send({ message: "User already exist" });
      }
      const result = await userCollection.insertOne(userInfo);
      res.send(result);
    });
    
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);
// Routes
app.get("/", (req, res) => {
  res.send("Hello World!");
});

//Start Server
app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
