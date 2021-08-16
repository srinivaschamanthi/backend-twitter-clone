const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const path = require("path");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const databasePath = path.join(__dirname, "twitterClone.db");

const app = express();

app.use(express.json());

let database = null;

const initializeDbAndServer = async () => {
  try {
    database = await open({
      filename: databasePath,
      driver: sqlite3.Database,
    });

    app.listen(3000, () =>
      console.log("Server Running at http://localhost:3000/")
    );
  } catch (error) {
    console.log(`DB Error: ${error.message}`);
    process.exit(1);
  }
};

initializeDbAndServer();

const convertTweetToJson = (dbObject) => {
  return {
    username: dbObject.username,
    tweet: dbObject.tweet,
    dateTime: dbObject.date_time,
  };
};

const tweetsStats = (dbObject) => {
  return {
    tweet: dbObject.tweet,
    likes: dbObject.likes,
    replies: dbObject.replies,
    dateTime: dbObject.date_time,
  };
};

//authenticate middleware
const authenticateToken = (request, response, next) => {
  const authHeader = request.headers["authorization"];
  let jwtToken;
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_KEY", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.user = payload;
        next();
      }
    });
  }
};

//register user API
app.post("/register/", async (request, response) => {
  const { name, username, password, gender } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const user = await database.get(getUserQuery);
  if (user !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const postUserQuery = `
            INSERT INTO
              user (name,username,password,gender) 
              VALUES (
                  '${name}',
                  '${username}',
                  '${hashedPassword}',
                  '${gender}'
              );
            `;
      await database.run(postUserQuery);
      response.status(200);
      response.send("User created successfully");
    }
  }
});

//login user API
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `
  SELECT
    *
  FROM
    user
  WHERE username = '${username}'
  `;
  const dbUser = await database.get(selectUserQuery);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordValid = await bcrypt.compare(password, dbUser.password);
    if (isPasswordValid === false) {
      response.status(400);
      response.send("Invalid password");
    } else {
      const payload = { username: username };
      const jwtToken = jwt.sign(payload, "MY_SECRET_KEY");
      response.send({ jwtToken });
    }
  }
});

const getUserDetails = async (username) => {
  const getUserIdQuery = `
  SELECT
    *
  FROM
    user
  WHERE
    username = '${username}';
  `;
  const user = await database.get(getUserIdQuery);
  const userId = user["user_id"];
  return userId;
};

//user tweets API
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request.user;
  const userId = await getUserDetails(username);
  const getFollowingUsers = `
  SELECT
    username,tweet,date_time
  FROM
    (follower INNER JOIN tweet ON follower.following_user_id=tweet.user_id) AS T NATURAL JOIN user 
  WHERE 
    follower.follower_user_id = ${userId}
  ORDER BY
    date_time DESC
  LIMIT 4;
  `;
  const tweets = await database.all(getFollowingUsers);
  response.send(tweets.map((tweet) => convertTweetToJson(tweet)));
});

// user follows API
app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request.user;
  const userId = await getUserDetails(username);
  const getFollowingNamesQuery = `
  SELECT
    name
  FROM
    follower INNER JOIN user ON follower.following_user_id = user.user_id
  WHERE follower_user_id = ${userId}
  `;
  const users = await database.all(getFollowingNamesQuery);
  response.send(users);
});

//follows user API
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request.user;
  const userId = await getUserDetails(username);
  const getFollowersQuery = `
  SELECT
    name
  FROM
    follower INNER JOIN user ON follower.follower_user_id = user.user_id 
  WHERE
    following_user_id = ${userId}
  `;
  const followers = await database.all(getFollowersQuery);
  response.send(followers);
});

// get tweets stats API
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { username } = request.user;
  const userId = await getUserDetails(username);
  const { tweetId } = request.params;
  const getTweetQuery = `
  SELECT
    *
  FROM
    tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id
  WHERE
    tweet_id = ${tweetId} AND follower_user_id = ${userId};
  `;
  const tweet = await database.get(getTweetQuery);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    const tweetId = tweet["tweet_id"];
    const getLikeCountQuery = `
    SELECT
      COUNT(*)
    FROM
      tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id
    WHERE tweet.tweet_id = ${tweetId}
    `;
    const getLikeCount = await database.all(getLikeCountQuery);
    const getReplyQuery = `
    SELECT
      COUNT(*)
    FROM
      tweet INNER JOIN reply ON tweet.tweet_id = reply.tweet_id
    WHERE tweet.tweet_id = ${tweetId}
    `;
    const getReplyCount = await database.all(getReplyQuery);
    response.send({
      tweet: tweet["tweet"],
      likes: getLikeCount[0]["COUNT(*)"],
      replies: getReplyCount[0]["COUNT(*)"],
      dateTime: tweet["date_time"],
    });
  }
});

//get tweet likes API
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  async (request, response) => {
    const { username } = request.user;
    const userId = await getUserDetails(username);
    const { tweetId } = request.params;
    const getTweetQuery = `
  SELECT
    *
  FROM
    tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id
  WHERE
    tweet_id = ${tweetId} AND follower_user_id = ${userId};
  `;
    const tweet = await database.get(getTweetQuery);
    if (tweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getLikeCountQuery = `
    SELECT
      username
    FROM
      (tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id) AS T INNER JOIN user ON like.user_id = user.user_id
    WHERE tweet.tweet_id = ${tweetId}
    `;
      const getLikeCount = await database.all(getLikeCountQuery);
      const likes = getLikeCount.map((user) => {
        return user["username"];
      });
      response.send({ likes });
    }
  }
);

// get replies api
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  async (request, response) => {
    const { username } = request.user;
    const userId = await getUserDetails(username);
    const { tweetId } = request.params;
    const getTweetQuery = `
  SELECT
    *
  FROM
    tweet INNER JOIN follower ON tweet.user_id = follower.following_user_id
  WHERE
    tweet_id = ${tweetId} AND follower_user_id = ${userId};
  `;
    const tweet = await database.get(getTweetQuery);
    if (tweet === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      const getReplyCountQuery = `
    SELECT
      name,reply
    FROM
      (tweet INNER JOIN reply ON tweet.tweet_id = reply.tweet_id) AS T INNER JOIN user ON reply.user_id = user.user_id
    WHERE tweet.tweet_id = ${tweetId}
    `;
      const getReplyCount = await database.all(getReplyCountQuery);
      response.send({ replies: getReplyCount });
    }
  }
);

// User Tweets List API
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request.user;
  const userId = await getUserDetails(username);
  const getUserTweets = `
  SELECT
    tweet,COUNT(*) AS likes,
    (
        SELECT
          COUNT(*) AS replies
        FROM
          tweet INNER JOIN reply ON tweet.tweet_id = reply.tweet_id
        WHERE tweet.user_id = ${userId}
        GROUP BY
          tweet.tweet_id
    ) AS replies,tweet.date_time
  FROM
    tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id
  WHERE tweet.user_id = ${userId}
  GROUP BY
    tweet.tweet_id;
  `;
  const tweets = await database.all(getUserTweets);
  response.send(tweets.map((tweet) => tweetsStats(tweet)));
});

// post a tweet
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request.user;
  const userId = await getUserDetails(username);
  const { tweet } = request.body;
  const postTweetQuery = `
    INSERT INTO
      tweet (tweet,user_id)
    VALUES
      ('${tweet}',${userId})
    `;
  await database.run(postTweetQuery);
  response.send("Created a Tweet");
});

//delete tweet API
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  async (request, response) => {
    const { username } = request.user;
    const userId = await getUserDetails(username);
    const { tweetId } = request.params;
    const getTweetQuery = `
    SELECT
      *
    FROM
      tweet
    WHERE tweet_id = ${tweetId}
    `;
    const tweet = await database.get(getTweetQuery);
    const { user_id } = tweet;
    if (user_id === userId) {
      const deleteTweetQuery = `
      DELETE FROM
        tweet
      WHERE tweet_id = ${tweetId}
      `;
      await database.run(deleteTweetQuery);
      response.send("Tweet Removed");
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);

module.exports = app;
