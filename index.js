const express = require("express");
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const dotenv = require("dotenv");
const { default: Stripe } = require("stripe");
const serviceAccount = require("./firebase-admin.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

//Middleware
app.use(cors());
app.use(express.json());

// require stripe
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

//Firebase token verify middleware
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.log(error);
    res.status(403).json({ message: "Invalid  or expired token" });
  }
};

const uri = process.env.DB_URL;

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
    const campParticipants = client
      .db("medi-ease")
      .collection("campParticipants");
    const paymentCollection = client
      .db("medi-ease")
      .collection("paymentHistory");

    // verify admin API
    const verifyAdmin = async (req, res, next) => {
      const email = req.user?.email;
      if (!email) {
        res.status(403).send("Forbidden");
      }
      const user = await userCollection.findOne({ email });
      if (user?.role !== "admin") {
        return res.status(403).send("Access denied: Admin only");
      }
      next();
    };

    //=============================================== Basic Api ==============================================//

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
    app.get("/user/camp-details/:id", verifyToken, async (req, res) => {
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
      joinInfo.conformation_status = "pending";
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

    // get camp participant
    app.get("/user/camp-participant/:id", async (req, res) => {
      const id = req.params.id;
      console.log(id);
      const query = { _id: new ObjectId(id) };
      const result = await campParticipants.findOne(query);
      res.send(result);
    });
    //======================================== API for admin access =======================================

    app.post("/admin/add-camp", verifyToken, verifyAdmin, async (req, res) => {
      const campData = req.body;
      campData.createdAt = new Date();
      const result = await campCollection.insertOne(campData);
      res.send(result);
    });

    app.get("/admin/get-camps", verifyToken, verifyAdmin, async (req, res) => {
      const email = req.query.email;
      const query = { created_by: email };
      const result = await campCollection.find(query).toArray();
      res.send(result);
    });
    app.get(
      "/admin/get-registered-camps",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.query.email;
        const query = { created_by: email };
        const result = await campParticipants.find(query).toArray();
        res.send(result);
      }
    );

    // registered Camp API
    app.patch(
      "/admin/camp-confirm/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        console.log(id);
        const result = await campParticipants.updateOne(
          { _id: new ObjectId(id) },
          { $set: { conformation_status: "confirmed" } }
        );
        res.send(result);
      }
    );
    app.delete(
      "/admin/register-camp-delete/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await campParticipants.deleteOne(query);
        res.send(result);
      }
    );

    //  user role API
    app.get("/user/role/:email", verifyToken, async (req, res) => {
      const { email } = req.params;
      try {
        const user = await userCollection.findOne({ email });
        if (!user) {
          return res.status(404).json({ message: "User not found" });
        }
        res.send(user);
      } catch (error) {
        console.log("Error fetching role:", error);
        res.status(500).json({ message: "Server Error" });
      }
    });

    //=========================================== Payment method API ==================================
    app.post("/create-payment-intent", async (req, res) => {
      const { amount } = req.body;
      console.log(amount);
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount * 100,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send(paymentIntent);
    });
    app.post("/payment/save-history", async (req, res) => {
      const { participantId, email, amount, transactionId, paymentMethod } =
        req.body.paymentData;

      const updateResult = await campParticipants.updateOne(
        {
          _id: new ObjectId(participantId),
        },
        { $set: { payment_status: "paid" } }
      );

      const paymentDoc = {
        participantId,
        email,
        amount: amount / 100,
        paymentMethod,
        transactionId,
        paidAt: new Date(),
      };
      const paymentResult = await paymentCollection.insertOne(paymentDoc);
      res.send(paymentResult);
    });
    app.get("/payment/history", async (req, res) => {
      const email = req.query.email;

      const result = await paymentCollection
        .find({
          email: email,
        })
        .toArray();

      res.send(result);
    });
    //==================================================================================================
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
