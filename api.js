/* Dependencies */
import express from "express";
import compression from "compression";
import { getTime, parseISO } from "date-fns";
import distance from "@turf/distance";
import _ from "lodash";
import got from "got";

/* Constants */
const BASE_URL = "https://storage.googleapis.com/storage/v1/b/malrot/o";
const DIRECT_URL = "https://storage.googleapis.com/malrot";
const MALROT_URL = "https://api.malrot.org";

const api = express();
api.use(compression()); // For an unknown reason, this is not working (seems linked to ES module)

//////////////////////
/////// API v1 ///////
//////////////////////

/**
 * ENDPOINT
 * GET https://api.malrot.org/v1/health
 * Returns a 200 response if GCP Storage (CDN) and api.malrot.org are up, otherwise 500.
 */
api.get("/v1/health", async (req, res) => {
  try {
    // Get an unused prefix to check for a 200 response without downloading the whole bucket!
    await got.get(`${BASE_URL}?prefix=AN_UNUSED_PREFIX`).json();
    return res.sendStatus(200);
  } catch (e) {
    return res.sendStatus(500);
  }
});

/**
 * ENDPOINT
 * GET https://api.malrot.org/v1/events/:event
 * Returns a specific MALROT JSON file (= a cultural event data)
 */
api.get("/v1/events/:id", async (req, res) => {
  try {
    const file = await got.get(`${DIRECT_URL}/${req.params.id}`).json();
    return res.json(file);
  } catch (e) {
    return res.sendStatus(500);
  }
});

/**
 * ENDPOINT
 * GET https://api.malrot.org/v1/events?PARAMS
 * See https://www.malrot.org/api for more info on params
 * Returns a JSON file listing all corresponding events
 */
api.get("/v1/events", async (req, res) => {
  const errors = [];

  // ERROR HANDLING
  // Check if `org` param is correctly set
  if (req.query.org) {
    if (req.query.org.includes(","))
      errors.push({
        code: `wrong_org_param`,
        message: `Org must be a unique value`,
      });
    if (req.query.org !== req.query.org.toLowerCase())
      errors.push({
        code: `wrong_org_param`,
        message: `Org must be in lowercase`,
      });
  }

  // Check if `around` param is correctly set
  if (req.query.around) {
    let around = req.query.around.split(",");
    around = around.map((i) => Number(i));

    if (
      isNaN(around[0]) ||
      isNaN(around[1]) ||
      isNaN(around[2]) ||
      around.length !== 3
    )
      errors.push({
        code: `wrong_around_param`,
        message: `Around param must be a list of 3 numbers, separated by commas`,
      });
    if (around[0] <= -180 || around[0] > 180)
      errors.push({
        code: `wrong_around_param`,
        message: `Longitude must be between -180 (inclusive) and 180 (exclusive)`,
      });
    if (around[1] < -90 || around[1] > 90)
      errors.push({
        code: `wrong_around_param`,
        message: `Latitude must be between -90 and 90`,
      });
    if (around[2] < 0)
      errors.push({
        code: `wrong_around_param`,
        message: `Distance must be greater than 0`,
      });
  }

  // Check if `country` param is correctly set
  if (req.query.country) {
    let country = req.query.country.split(",");
    for (const c of country) {
      if (c !== c.toUpperCase())
        errors.push({
          code: `wrong_country_param/${c}`,
          message: `ISO 3166-1 alpha-2 country code must be in uppercase`,
        });
      if (/[a-zA-Z]/.test(c) == false)
        errors.push({
          code: `wrong_country_param/${c}`,
          message: `ISO 3166-1 alpha-2 country code must be only letters`,
        });
      if (c.length !== 2)
        errors.push({
          code: `wrong_country_param/${c}`,
          message: `ISO 3166-1 alpha-2 country code must be 2-letter long`,
        });
    }
  }

  // Check if `updated_at` param is correctly set
  if (req.query.updated_at) {
    let updated_at = Number(req.query.updated_at);
    if (isNaN(updated_at))
      errors.push({
        code: `wrong_updated_at_param`,
        message: `Updated_at must be a number`,
      });
    if (updated_at < 0)
      errors.push({
        code: `wrong_updated_at_param`,
        message: `Updated_at must be greater than 0`,
      });
  }

  // IF ERRORS, RETURNS THEM + SEND 400
  if (errors.length > 0) return res.status(400).json(errors);

  // IF NO ERROR, CONTINUE
  try {
    // Get all events from CDN (GCP Storage)
    // Optionally filtered by `org` param (= prefix in GCP Storage API)
    let events;
    if (req.query.org)
      events = await got.get(`${BASE_URL}?prefix=${req.query.org}`).json();
    else events = await got.get(`${BASE_URL}`).json();
    events = events.items;

    // Prepare data to be returned
    let data = [];
    if (events) {
      events.map((object) => {
        data.push({
          title: object.metadata.title,
          endpoint: `${MALROT_URL}/v1/events/${object.name}`,
          created_at: getTime(parseISO(object.timeCreated)),
          updated_at: getTime(parseISO(object.updated)),
          country: object.metadata.country,
          longitude: Number(object.metadata.longitude),
          latitude: Number(object.metadata.latitude),
        });
      });
    }

    // Keep only events that match `country` param
    if (req.query.country) {
      let country = req.query.country.split(",");
      data = data.filter((event) => country.includes(event.country));
    }

    // Keep only events that match `updated_after` param
    if (req.query.updated_after) {
      data = data.filter((event) => event.updated_at > req.query.updated_after);
    }

    // Keep only events that match `around` param
    if (req.query.around) {
      let around = req.query.around.split(",");

      for (const event of data) {
        // Calculate distance in km between `around` param (= From) and event (= To)
        const distance_in_km = distance(
          [around[0], around[1]],
          [event.longitude, event.latitude]
        );
        event.distance = distance_in_km;
      }
      // Keep only events that are within distance
      data = data.filter((event) => event.distance < around[2]);
    }

    data = _.sortBy(data, ["distance"]);
    return res.json(data);
  } catch (e) {
    return res.sendStatus(500);
  }
});

/**
 * ENDPOINT
 * GET https://api.malrot.org/*
 * Returns 404 error for all unknown endpoints
 */
api.get("*", (req, res) => res.sendStatus(404));

/////////////////////////
/////// START API ///////
/////////////////////////

api.listen(process.env.PORT || 8080);
