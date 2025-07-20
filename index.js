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
    res.status(401).json({ message: "Invalid  or expired token" });
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
    const feedbackCollection = client.db("medi-ease").collection("feedbacks");

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

    // verify participant API
    const verifyParticipant = async (req, res, next) => {
      const email = req.user?.email;
      if (!email) {
        res.status(403).send("Forbidden");
      }
      const user = await userCollection.findOne({ email });
      if (user?.role !== "participant") {
        return res.status(403).send("Access denied: Participant only");
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
    app.get("/all-camps", verifyToken, verifyParticipant, async (req, res) => {
      const { search, sort } = req.query;
      const query = {};
      const sortOption = {};
      if (search) {
        query.camp_name = { $regex: search, $options: "i" };
      }

      // sorting logic
      if (sort === "Most Registered") {
        sortOption.participant_count = -1;
      } else if (sort === "Camp Fees") {
        sortOption.camp_fee = 1;
      } else if (sort === "Alphabetical Order") {
        sortOption.camp_name;
      } else if (sort === "Recent Camp") {
        sortOption.createdAt = -1;
      }

      const result = await campCollection
        .find(query)
        .sort(sortOption)
        .toArray();
      res.send(result);
    });

    // get user ratings
    app.get("/ratings", async (req, res) => {
      const result = await feedbackCollection
        .find()
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray();
      res.send(result);
    });

    //======================================= API for user =================================

    // get camp details
    app.get(
      "/user/camp-details/:id",
      verifyToken,
      verifyParticipant,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await campCollection.findOne(query);
        res.send(result);
      }
    );

    // save user join-camp info
    app.post(
      "/user/join-camp",
      verifyToken,
      verifyParticipant,
      async (req, res) => {
        const joinInfo = req.body;
        joinInfo.payment_status = "unpaid";
        joinInfo.confirmation_status = "pending";
        const result = await campParticipants.insertOne(joinInfo);

        const campId = joinInfo.campId;
        await campCollection.updateOne(
          { _id: new ObjectId(campId) },
          { $inc: { participant_count: 1 } }
        );

        res.send(result);
      }
    );

    // get registered camps
    app.get(
      "/user/registeredCamps",
      verifyToken,
      verifyParticipant,
      async (req, res) => {
        const email = req.query.email;
        const page = parseInt(req.query.page);
        const size = parseInt(req.query.size);
        const searchText = req.query.search;
        console.log(searchText);
        console.log("registeredCamps", page, size);
        const query = { participant_email: email };
        if (searchText) {
          query.camp_name = { $regex: searchText, $options: "i" };
        }
        const result = await campParticipants
          .find(query)
          .skip(page * size)
          .limit(size)
          .toArray();
        res.send(result);
      }
    );

    // cancel register camp
    app.delete("/user/camp-cancel/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await campParticipants.deleteOne(query);
      res.send(result);
    });

    // get count for registered camp
    app.get(
      "/user/participant-camp-count",
      verifyToken,
      verifyParticipant,
      async (req, res) => {
        const email = req.query.email;
        const count = await campParticipants.countDocuments({
          participant_email: email,
        });
        res.send({ count });
      }
    );

    // check user joined
    app.get(
      "/user/is-joined",
      verifyToken,
      verifyParticipant,
      async (req, res) => {
        const { campId, email } = req.query;

        const existing = await campParticipants.findOne({
          participant_email: email,
          campId,
        });
        res.send({ alreadyJoined: !!existing });
      }
    );

    // get camp participant
    app.get(
      "/user/camp-participant/:id",
      verifyToken,
      verifyParticipant,
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await campParticipants.findOne(query);
        res.send(result);
      }
    );

    // user feedback data save
    app.post(
      "/user/feedback",
      verifyToken,
      verifyParticipant,
      async (req, res) => {
        const feedbackData = req.body;
        const result = await feedbackCollection.insertOne(feedbackData);
        res.send(result);
      }
    );

    // participant analytics
    app.get(
      "/user/analytics",
      verifyToken,
      verifyParticipant,
      async (req, res) => {
        const email = req.query.email;
        console.log(email);

        const totalJoinedCamps = await campParticipants.countDocuments({
          participant_email: email,
        });

        const totalPaidPayments = await paymentCollection.countDocuments({
          email,
          payment_status: "paid",
        });

        const totalPendingPayments = await paymentCollection.countDocuments({
          email,
          payment_status: "unpaid",
        });

        const paidAmountAgg = await paymentCollection
          .aggregate([
            {
              $match: {
                email: email,
                payment_status: "paid",
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: { $toDouble: "$amount" } },
              },
            },
          ])
          .toArray();
        const totalPaidAmount = paidAmountAgg[0]?.total || 0;
        res.send({
          totalJoinedCamps,
          totalPaidPayments,
          totalPendingPayments,
          totalPaidAmount,
        });
      }
    );
    //======================================== API for admin access =======================================

    app.post("/admin/add-camp", verifyToken, verifyAdmin, async (req, res) => {
      const campData = req.body;
      campData.createdAt = new Date();
      const result = await campCollection.insertOne(campData);
      res.send(result);
    });

    app.get("/admin/get-camps", verifyToken, verifyAdmin, async (req, res) => {
      const email = req.query.email;
      const searchText = req.query.search;
      const page = parseInt(req.query.page);
      const size = parseInt(req.query.size);

      const query = { created_by: email };
      if (searchText) {
        query.camp_name = { $regex: searchText, $options: "i" };
      }
      const result = await campCollection
        .find(query)
        .skip(page * size)
        .limit(size)
        .toArray();
      res.send(result);
    });

    // get count Api for pagination
    app.get(
      "/admin/camps/count",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const count = await campCollection.estimatedDocumentCount();
        res.send({ count });
      }
    );

    // get all data registered
    app.get(
      "/admin/get-registered-camps",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.query.email;
        const searchText = req.query.search;
        console.log(searchText);
        const page = parseInt(req.query.page);
        const size = parseInt(req.query.size);
        const query = { created_by: email };

        if (searchText) {
          query.participant_name = { $regex: searchText, $options: "i" };
        }
        const result = await campParticipants
          .find(query)
          .skip(page * size)
          .limit(size)
          .toArray();
        res.send(result);
      }
    );

    // get count Api for pagination
    app.get(
      "/admin/registeredCamp/count",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const count = await campParticipants.estimatedDocumentCount();
        res.send({ count });
      }
    );

    //conformed camp when successfully pay
    app.patch(
      "/admin/camp-confirm/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;

        const result = await campParticipants.updateOne(
          { _id: new ObjectId(id) },
          { $set: { confirmation_status: "confirmed" } }
        );
        res.send(result);
      }
    );
    // delete registered camp (payment=unpaid , status=pending)
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

    //update added camp by admin
    app.patch(
      "/admin/campUpdate/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const updatedData = req.body;
        console.log(updatedData);
        const campId = req.params.id;
        const result = await campCollection.updateOne(
          {
            _id: new ObjectId(campId),
          },
          { $set: updatedData }
        );
        res.send(result);
      }
    );
    // delete added camp by admin
    app.delete(
      "/admin/deleteCamp/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const campId = req.params.id;
        const result = campCollection.deleteOne({ _id: new ObjectId(campId) });
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

    // admin Analytics API
    app.get("/admin/analytics", verifyToken, verifyAdmin, async (req, res) => {
      const now = new Date();
      const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const startOfLastMonth = new Date(
        now.getFullYear(),
        now.getMonth() - 1,
        1
      );
      const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      // total participants
      const totalParticipants = await userCollection.countDocuments({
        role: "participant",
      });
      const thisMonthParticipants = await userCollection.countDocuments({
        role: "participant",
        createdAt: { $gte: startOfThisMonth },
      });

      const lastMonthParticipants = await userCollection.countDocuments({
        role: "participant",
        createdAt: { $gte: startOfLastMonth, $lt: endOfLastMonth },
      });

      // total camp
      const totalCamps = await campCollection.countDocuments();
      const thisMonthCamps = await campCollection.countDocuments({
        createdAt: { $gte: startOfThisMonth },
      });
      const lastMonthCamps = await campCollection.countDocuments({
        createdAt: { $gte: startOfLastMonth, $lt: endOfLastMonth },
      });

      // total paid payment
      const totalPaidPayments = await paymentCollection.countDocuments({
        payment_status: "paid",
      });

      const thisMonthPaidPayments = await paymentCollection.countDocuments({
        payment_status: "paid",
        paidAt: { $gte: startOfThisMonth },
      });
      const lastMonthPaidPayments = await paymentCollection.countDocuments({
        payment_status: "paid",
        paidAt: { $gte: startOfLastMonth, $lt: endOfLastMonth },
      });

      // total pending payment
      const totalPendingPayments = await paymentCollection.countDocuments({
        payment_status: "unpaid",
      });

      // Total Revenue (This & Last Month)
      const revenueResult = await paymentCollection
        .aggregate([
          { $match: { payment_status: "paid" } },
          { $group: { _id: null, totalRevenue: { $sum: "$amount" } } },
        ])
        .toArray();

      const totalRevenue = revenueResult[0]?.totalRevenue || 0;

      const thisMonthRevenueResult = await paymentCollection
        .aggregate([
          {
            $match: {
              payment_status: "paid",
              paidAt: { $gte: startOfThisMonth },
            },
          },
          { $group: { _id: null, revenue: { $sum: "$amount" } } },
        ])
        .toArray();

      const thisMonthRevenue = thisMonthRevenueResult[0]?.revenue || 0;

      const lastMonthRevenueResult = await paymentCollection
        .aggregate([
          {
            $match: {
              payment_status: "paid",
              paidAt: { $gte: startOfLastMonth, $lt: endOfLastMonth },
            },
          },
          { $group: { _id: null, revenue: { $sum: "$amount" } } },
        ])
        .toArray();

      const lastMonthRevenue = lastMonthRevenueResult[0]?.revenue || 0;

      // Calculate % Changes
      const calculateChange = (current, previous) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return (((current - previous) / previous) * 100).toFixed(2);
      };

      res.json({
        totalParticipants,
        participantChange: calculateChange(
          thisMonthParticipants,
          lastMonthParticipants
        ),
        totalCamps,
        campChange: calculateChange(thisMonthCamps, lastMonthCamps),
        totalPaidPayments,
        paidPaymentChange: calculateChange(
          thisMonthPaidPayments,
          lastMonthPaidPayments
        ),
        totalPendingPayments,
        totalRevenue,
        revenueChange: calculateChange(thisMonthRevenue, lastMonthRevenue),
      });
    });

    //=========================================== update profile data ===================================

    app.patch(
      "/admin/updateProfile/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const { name, photoURL } = req.body;

        console.log(name, photoURL);
        const query = { email: email };
        const updateDoc = {
          $set: {
            name: name,
            photoURL: photoURL,
          },
        };
        const result = await userCollection.updateOne(query, updateDoc);
        res.send(result);
        console.log(result);
      }
    );

    // update participant profile
    app.patch(
      "/participant/updateProfile/:email",
      verifyToken,
      verifyParticipant,
      async (req, res) => {
        const email = req.params.email;
        const { name, photoURL } = req.body;

        console.log(name, photoURL);
        const query = { email: email };
        const updateDoc = {
          $set: {
            name: name,
            photoURL: photoURL,
          },
        };
        const result = await userCollection.updateOne(query, updateDoc);
        res.send(result);
        console.log(result);
      }
    );

    //=========================================== Payment method API ==================================
    app.post("/create-payment-intent", async (req, res) => {
      const { amount } = req.body;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount * 100,
        currency: "usd",
        payment_method_types: ["card"],
      });
      res.send(paymentIntent);
    });
    // save payment history and also update payment status and conform status
    app.post("/payment/save-history", verifyToken, async (req, res) => {
      const {
        participantId,
        camp_name,
        payment_status,
        confirmation_status,
        email,
        amount,
        transactionId,
        paymentMethod,
      } = req.body.paymentData;

      const updateResult = await campParticipants.updateOne(
        {
          _id: new ObjectId(participantId),
        },
        { $set: { payment_status: "paid" } }
      );
      console.log(updateResult);
      const paymentDoc = {
        participantId,
        camp_name,
        payment_status,
        confirmation_status,
        email,
        amount: amount / 100,
        paymentMethod,
        transactionId,
        paidAt: new Date(),
      };
      const paymentResult = await paymentCollection.insertOne(paymentDoc);
      res.send(paymentResult);
    });

    app.get(
      "/payment/history",
      verifyToken,
      verifyParticipant,
      async (req, res) => {
        const email = req.query.email;
        const page = parseInt(req.query.page);
        const size = parseInt(req.query.size);
        const searchText = req.query.search;

        const query = { email: email };
        if (searchText) {
          query.camp_name = { $regex: searchText, $options: "i" };
        }
        const result = await paymentCollection
          .find(query)
          .skip(page * size)
          .limit(size)
          .toArray();

        res.send(result);
      }
    );
    app.get(
      "/payment/participant-payment-count",
      verifyToken,
      verifyParticipant,
      async (req, res) => {
        const email = req.query.email;
        console.log(email);
        const count = await paymentCollection.countDocuments({
          email: email,
        });

        res.send({ count });
      }
    );
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
