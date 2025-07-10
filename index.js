const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
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
    const campCollection = client.db("medi-ease").collection("camps");
    const campParticipants = client.db("medi-ease").collection("campParticipants");
    const paymentHistory = client.db("medi-ease").collection("paymentHistory");

    // insert user data from client side
    app.post("/userInfo", async (req, res) => {
      const userInfo = req.body.userInfo;
      userInfo.createdAt = new Date();
      const existing = await userCollection.findOne({ email: userInfo.email });
      if (existing) {
        return res.status(409).send({ message: "User already exist" });
      }
      const result = await userCollection.insertOne(userInfo);
      res.send(result);
    });

    // get popular camps
    app.get("/popular-camps", async (req, res) => {
      const result = await campCollection
        .find()
        .limit(6)
        .sort({ participant_count: -1 })
        .toArray();
      res.send(result);
    });

    // get all camps
    app.get("/all-camps", async (req, res) => {
      const result = await campCollection.find().toArray();
      res.send(result);
    });

    //======================================= API for user =================================

    // get camp details
    app.get("/user/camp-details/:id", async (req, res) => {
      const id = req.params.id;
      console.log(id);
      const query = { _id: new ObjectId(id) };
      const result = await campCollection.findOne(query);
      res.send(result);
    });

    // save user join-camp info
    app.post("/user/join-camp", async (req, res) => {
      const joinInfo = req.body;
      joinInfo.payment_status = "unpaid";
      const result = await campParticipants.insertOne(joinInfo);

      const campId = joinInfo.campId;
      await campCollection.updateOne(
        { _id: new ObjectId(campId) },
        { $inc: { participant_count: 1 } }
      );

      res.send(result);
    });

    // get registered camps
    app.get("/user/registeredCamps", async (req, res) => {
      const email = req.query.email;

      const query = { participant_email: email };
      const result = await campParticipants.find(query).toArray();
      res.send(result);
    });

    // check user joined
    app.get("/user/is-joined", async (req, res) => {
      const { campId, email } = req.query;
      console.log(campId, email);
      const existing = await campParticipants.findOne({
        participant_email: email,
        campId,
      });
      res.send({ alreadyJoined: !!existing });
    });
    //======================================== API for admin access =====================

    app.post("/admin/add-camp", async (req, res) => {
      const campData = req.body;
      campData.createdAt = new Date();
      const result = await campCollection.insertOne(campData);
      res.send(result);
    });

    app.get("/admin/get-camps", async (req, res) => {
      const email = req.query.email;
      const query = { created_by: email };
      const user = await userCollection.findOne({ email });

      if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "Forbidden access" });
      }

      const result = await campCollection.find(query).toArray();
      res.send(result);
    });

    //=============================================================================
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
