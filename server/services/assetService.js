import { pool } from "../db/connection.js";
import { BOOKING_STATUS } from "../config/appConfig.js";

export const assetService = {
  // Single query that calculates:
  // - current usage (pooled vs non-pooled logic)
  // - available capacity
  // - user's active booking (if any)
  // - currently active occupants

  async getAllAssets(userName = null, userType = "individual") {
    const query = `
  SELECT  
    f.*, 
    f.name AS display_name, 
    COALESCE(usage.active_count, 0) as current_usage, 
    (f.total_capacity - COALESCE(usage.active_count, 0)) as available_capacity, 
    ( 
      SELECT json_build_object( 
        'id', b.id, -- ADDED: Unique ID for identity filtering
        'starts_at', b.starts_at, 
        'ends_at', b.ends_at, 
        'status', b.status 
      ) 
      FROM bookings b 
      WHERE b.facility_id = f.id  
      AND b.booked_by = $1  
      AND b.status IN ($2, $3) 
      AND b.ends_at > NOW() 
      ORDER BY b.starts_at ASC 
      LIMIT 1 
    ) as my_active_booking,
    (
      SELECT COALESCE(json_agg(json_build_object(
        'id', b.id, -- ADDED: Unique ID for identity filtering
        'booked_by', b.booked_by,
        'user_type', b.user_type,
        'club_name', b.club_name,
        'starts_at', b.starts_at,
        'ends_at', b.ends_at,
        'unit_name', u.unit_name
      )), '[]'::json)
      FROM bookings b
      LEFT JOIN facility_units u ON b.unit_id = u.id
      WHERE b.facility_id = f.id
      AND b.status IN ($2, $3)
      AND b.starts_at <= NOW() AND b.ends_at > NOW()
    ) as active_occupants
  FROM facilities f
  LEFT JOIN ( 
    SELECT 
      f2.id as facility_id,
      CASE 
        WHEN f2.is_pooled = true THEN COUNT(b.id)
        ELSE COUNT(DISTINCT b.unit_id)
      END as active_count
    FROM facilities f2
    LEFT JOIN bookings b 
      ON f2.id = b.facility_id
      AND b.status IN ($2, $3)
      AND b.starts_at <= NOW() 
      AND b.ends_at > NOW()
    GROUP BY f2.id, f2.is_pooled
  ) usage ON f.id = usage.facility_id 
  WHERE (f.category != 'Event Space' OR $4 = 'club') 
  ORDER BY f.category ASC, f.name ASC;
`;

    const values = [
      userName,
      BOOKING_STATUS.SCHEDULED,
      BOOKING_STATUS.CHECKED_IN,
      userType,
    ];

    const { rows } = await pool.query(query, values);

    return rows.map((row) => {
      const availableCapacity = Math.max(
        0,
        parseInt(row.available_capacity, 10),
      );
      return {
        ...row,
        available_capacity: availableCapacity,
        current_status: availableCapacity > 0 ? "available" : "in_use",
      };
    });
  },

  async getFacilityUnits(facilityId) {
    const query = `
      SELECT id, unit_name, is_operational 
      FROM facility_units 
      WHERE facility_id = $1 AND is_operational = true
      ORDER BY unit_name ASC;
    `;
    const { rows } = await pool.query(query, [facilityId]);
    return rows;
  },

  async seedDemoData() {
    await pool.query("DELETE FROM bookings");
    await pool.query("DELETE FROM facility_units");
    await pool.query("DELETE FROM facilities");

    const facilities = [
      [
        "Main Library",
        "Study Space",
        100,
        true,
        30,
        480,
        "00:00:00",
        "23:59:59",
        "Asia/Kolkata",
      ],
      [
        "Basketball Courts",
        "Sports",
        3,
        false,
        30,
        120,
        "07:00:00",
        "23:59:59",
        "Asia/Kolkata",
      ],
      [
        "TT Tables",
        "Sports",
        15,
        true,
        30,
        60,
        "08:00:00",
        "22:00:00",
        "Asia/Kolkata",
      ],
      [
        "Cricket Grounds",
        "Sports",
        2,
        false,
        60,
        180,
        "06:00:00",
        "19:00:00",
        "Asia/Kolkata",
      ],
      [
        "Main Auditorium",
        "Event Space",
        1,
        false,
        30,
        780,
        "08:00:00",
        "21:00:00",
        "Asia/Kolkata",
      ],
    ];

    for (const [
      name,
      cat,
      cap,
      pooled,
      minD,
      maxD,
      open,
      close,
      tz,
    ] of facilities) {
      const res = await pool.query(
        `INSERT INTO facilities 
         (name, category, total_capacity, is_pooled, min_duration_minutes, max_duration_minutes, open_time, close_time, timezone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [name, cat, cap, pooled, minD, maxD, open, close, tz],
      );

      if (!pooled) {
        const facilityId = res.rows[0].id;
        for (let i = 1; i <= cap; i++) {
          let specificUnitName;

          if (name === "Basketball Courts") {
            specificUnitName = `Court ${String.fromCharCode(64 + i)}`;
          } else if (name === "Cricket Grounds") {
            const groundNames = ["NTB Ground", "Sports Complex Ground"];
            specificUnitName = groundNames[i - 1] || `Ground ${i}`;
          } else if (name === "Main Auditorium") {
            specificUnitName = "Auditorium Hall";
          } else {
            specificUnitName = `Unit ${i}`;
          }

          await pool.query(
            "INSERT INTO facility_units (facility_id, unit_name) VALUES ($1, $2)",
            [facilityId, specificUnitName],
          );
        }
      }
    }
  },
};
