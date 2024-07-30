import { client } from "../dbConnection";
import * as Sentry from "@sentry/node";
import { generateReferralCode } from "../../utils/commonFunctions";

async function insertIntoWaitlist(phoneNumber, firstSix, lastSix) {
  const queryText = `INSERT INTO waitlist (position, users_user_id, creation_date, referrals, referral_code, code_type, timestamp) VALUES ((SELECT COUNT(*) + 1 FROM waitlist), $1, $2, $3, $4, $5, $6) RETURNING id, position, referral_code;`;
  const timestamp = new Date().getTime();
  let values = [phoneNumber, timestamp, 0, firstSix, "firstSix", timestamp];
  let insertFailed = true;
  let count = 0;
  while (insertFailed) {
    if (count === 1) {
      // Try last six before random
      values = [
        phoneNumber,
        new Date().getTime(),
        0,
        lastSix,
        "lastSix",
        timestamp,
      ];
    } else if (count >= 2) {
      // create random code
      values = [
        phoneNumber,
        new Date().getTime(),
        0,
        generateReferralCode(),
        "random",
        timestamp,
      ];
    }
    // To stop after 10 tries
    if (count >= 10) {
      insertFailed = false;
    }
    try {
      const { rows } = await client.query(queryText, values);
      if (rows.length) {
        insertFailed = false;
        return rows[0];
      }
      count++;
    } catch (e) {
      count++;
      console.log(
        `Error in insertIntoWaitlist while trying new referral code: ${e.message}`
      );
    }
  }
  if (count === 10) {
    console.log(
      `Error in insertIntoWaitlist: Didn't insert a row after 10 tries`
    );
    Sentry.captureException(
      `After 10 tries of trying to insert someone into the waitlist it didn't work. Must be some other issue.`
    );
    return false;
  }
}

async function updatePositionAndTimestamp(
  position,
  positionAbove,
  waitlistId,
  referraler = false
) {
  try {
    // Query to select the timestamps based on the positions
    // If that position is not there we get the next closest one above if the bigger position or below if the smaller position
    let selectQueryText = `
            (
                SELECT timestamp, position
                FROM waitlist
                WHERE position <= $1
                ORDER BY position DESC
                LIMIT 1
            )
            UNION
            (
                SELECT timestamp, position
                FROM waitlist
                WHERE position >= $2
                ORDER BY position ASC
                LIMIT 1
            ) 
        `;

    let selectValues = [position, positionAbove];
    const { rowCount, rows } = await client.query(
      selectQueryText,
      selectValues
    );

    if (rowCount) {
      const timestamp1 = parseInt(rows[0].timestamp, 10);
      const timestamp2 = parseInt(rows[1].timestamp, 10);
      // Calculate the average timestamp
      const middleTimestamp = Math.floor((timestamp1 + timestamp2) / 2);
      // Assuming you've calculated the new position and new timestamp here
      let newPosition = position; // calculate new position;
      let updateQueryText;

      if (referraler) {
        updateQueryText = `UPDATE waitlist SET position = $1, timestamp = $2, referrals = referrals + 1 WHERE id = $3;`;
      } else {
        updateQueryText = `UPDATE waitlist SET position = $1, timestamp = $2, used_referral_code = true WHERE id = $3;`;
      }
      // Query to update the position and timestamp of an entry based on its id
      let updateValues = [newPosition, middleTimestamp, waitlistId];
      await client.query(updateQueryText, updateValues);
      console.log("Entry updated successfully");
      return true;
    } else {
      console.log("No rows found for the given positions");
      return false;
    }
  } catch (e) {
    console.log(`Error in updating entry: ${e.message}`);
    throw new Error(`Error in updating entry: ${e.message}`);
  }
}

async function updateReferralCountOnOffWaitlist(referralersUserId) {
  const queryText = `UPDATE off_waitlist SET referrals = referrals + 1 WHERE users_user_id = $1;`;
  const values = [referralersUserId];
  try {
    const { rowCount } = await client.query(queryText, values);

    if (rowCount) return true;

    throw new Error(
      `Did no update an off waitlist row for the user id of ${referralersUserId}`
    );
  } catch (e) {
    console.log(`Error in updateReferralCountOnOffWaitlist: ${e.message}`);
    throw new Error(`Error in updateReferralCountOnOffWaitlist: ${e.message}`);
  }
}

async function getWaitlistPositionOfUser(userId) {
  // Position can be slightly off because positions are updated based on the timestamp every time the updatePosition cron job is run
  // We are okay with this because we are choosing speed and it seeming fair from their point of view than it being exactly fair
  let queryText = `SELECT id, position, used_referral_code as "usedReferralCode" FROM waitlist WHERE users_user_id = $1;`;
  let values = [userId];
  try {
    const { rowCount, rows } = await client.query(queryText, values);
    if (rowCount) return rows[0];
    return false;
  } catch (e) {
    console.log(`Error in getWaitListPositionOfUser: ${e.message}`);
    throw new Error(`Error in getWaitListPositionOfUser: ${e.message}`);
  }
}

async function checkReferralCode(referralCode, userId) {
  const queryText = `SELECT
    (SELECT json_build_object('id',id, 'position',position, 'userId', users_user_id) FROM waitlist WHERE referral_code = $1 AND users_user_id != $2) AS "dataInWaitlist",
    (SELECT json_build_object('id',id, 'userId', users_user_id) FROM off_waitlist WHERE referral_code = $1 AND users_user_id != $2) AS "dataInOffWaitlist";
`;
  let values = [referralCode, userId];
  try {
    const { rowCount, rows } = await client.query(queryText, values);
    if (rowCount) return rows[0];
    return false;
  } catch (e) {
    console.log(`Error in checkReferralCode: ${e.message}`);
    throw new Error(`Error in checkReferralCode: ${e.message}`);
  }
}

async function getWaitlistInfo(userId) {
  const values = [userId];
  // We make sure that the position can never be greater than the max position
  let queryText = `
    WITH max_position AS (
        SELECT GREATEST(MAX(position), COUNT(*)) AS max_pos
        FROM waitlist
    ), waitlist_referral AS (SELECT waitlist_referral_link FROM users WHERE id = $1)
    SELECT position, 
        code_type as "codeType",
        used_referral_code as "usedReferralCode",
        max_position.max_pos as "maxPosition",
        referral_code as "referralCode",
        waitlist_referral.waitlist_referral_link as "waitlistReferralLink"
    FROM waitlist, max_position, waitlist_referral
    WHERE users_user_id = $1;
    `;

  try {
    const { rows, rowCount } = await client.query(queryText, values);
    if (rowCount) return rows[0];
    return null;
  } catch (error) {
    console.log(`Error in getWaitlistInfo: ${error.message}`);
    throw new Error(`Error in getWaitlistInfo: ${error.message}`);
  }
}

async function getFirstWaitlistEntries(amount) {
  const values = [amount];
  let queryText = `SELECT id, users_user_id as "userId", referrals, referral_code as "referralCode", code_type as "codeType", used_referral_code as "usedReferralCode", creation_date as "creationDate" FROM waitlist ORDER BY timestamp ASC LIMIT $1;`;
  try {
    const { rows, rowCount } = await client.query(queryText, values);
    if (rowCount)
      return {
        waitlistEntries: rows,
        realUserEntries: rows.filter((entry) => entry.userId),
      };
    return false;
  } catch (error) {
    console.log(`Error in getFirstWaitlistEntries: ${error.message}`);
    throw new Error(`Error in getFirstWaitlistEntries: ${error.message}`);
  }
}

async function getWaitlistEntryByUserId(userId) {
  const values = [userId];
  let queryText = `SELECT id, users_user_id as "userId", referrals, referral_code as "referralCode", code_type as "codeType", used_referral_code as "usedReferralCode", creation_date as "creationDate" FROM waitlist WHERE users_user_id = $1;`;
  try {
    const { rows, rowCount } = await client.query(queryText, values);
    if (rowCount) return rows;
    return null;
  } catch (error) {
    console.log(`Error in getFirstWaitlistEntries: ${error.message}`);
    throw new Error(`Error in getFirstWaitlistEntries: ${error.message}`);
  }
}

async function moveWaitlistEntriesToOffWaitlist(entries, batchSize) {
  const numBatches = Math.ceil(entries.length / batchSize);
  try {
    for (let batch = 0; batch < numBatches; batch++) {
      let values = [];
      let placeholders = [];

      for (let i = 0; i < batchSize; i++) {
        const timestamp = new Date().getTime();
        const index = batch * batchSize + i;
        if (index >= entries.length) {
          break;
        }
        const entry = entries[index];
        values.push(
          entry.userId,
          entry.referrals,
          entry.referralCode,
          entry.codeType,
          entry.usedReferralCode,
          entry.creationDate,
          timestamp
        );
        const offset = i * 7;
        placeholders.push(
          `($${1 + offset}, $${2 + offset}, $${3 + offset}, $${4 + offset}, $${
            5 + offset
          }, $${6 + offset}, $${7 + offset})`
        );
      }

      const queryText = `INSERT INTO off_waitlist (users_user_id, referrals, referral_code, code_type, used_referral_code, joined_waitlist_date, creation_date) VALUES ${placeholders.join(
        ", "
      )};`;

      const { rowCount } = await client.query(queryText, values);
      if (!rowCount) {
        throw new Error(
          `Error in moveWaitlistEntriesToOffWaitlist: Inserting the batch ${batch} failed`
        );
      }
    }
    return true;
  } catch (error) {
    console.log(`Error in moveWaitlistEntriesToOffWaitlist: ${error.message}`);
    throw new Error(
      `Error in moveWaitlistEntriesToOffWaitlist: ${error.message}`
    );
  }
}

async function removeEntriesFromWaitlist(entries, batchSize) {
  const numBatches = Math.ceil(entries.length / batchSize);

  try {
    for (let batch = 0; batch < numBatches; batch++) {
      let values = [];
      let placeholders = [];

      for (let i = 0; i < batchSize; i++) {
        const index = batch * batchSize + i;
        if (index >= entries.length) {
          break;
        }
        values.push(entries[index].id);
        placeholders.push(`$${i + 1}`);
      }

      const queryText = `DELETE FROM waitlist WHERE id IN (${placeholders.join(
        ", "
      )});`;

      const { rowCount } = await client.query(queryText, values);
      if (rowCount === 0) {
        console.log("No rows were deleted in this batch");
      }
    }
    return true;
  } catch (error) {
    console.log(`Error in removeEntriesFromWaitlist: ${error.message}`);
    throw new Error(`Error in removeEntriesFromWaitlist: ${error.message}`);
  }
}

export {
  insertIntoWaitlist,
  updatePositionAndTimestamp,
  getWaitlistPositionOfUser,
  checkReferralCode,
  getWaitlistInfo,
  getFirstWaitlistEntries,
  moveWaitlistEntriesToOffWaitlist,
  removeEntriesFromWaitlist,
  getWaitlistEntryByUserId,
  updateReferralCountOnOffWaitlist,
};
