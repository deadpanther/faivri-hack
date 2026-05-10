"""
Seed script for FairCheck auto repair pricing data.
Dual-market: India (INR, paise) + US (USD, cents).

Usage:
  cd backend
  python -m scripts.seed_auto_repair

Or with DATABASE_URL env var:
  DATABASE_URL=postgresql+asyncpg://... python scripts/seed_auto_repair.py
"""

import asyncio
import uuid
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy import text

# ---------- INDIA DATA (prices in paise = INR * 100) ----------

INDIA_CITIES = ["Mumbai", "Pune", "Bangalore", "Delhi"]

# Base prices are national averages; city multipliers adjust them
INDIA_CITY_MULTIPLIER = {
    "Mumbai": 1.15,    # Metro premium
    "Pune": 1.00,      # Base
    "Bangalore": 1.10,  # Tech city premium
    "Delhi": 1.12,      # Capital premium
}

INDIA_MAKES = [
    {"make": "Maruti", "models": ["Swift", "Baleno", "Brezza", "Alto", "WagonR"]},
    {"make": "Honda", "models": ["City", "Amaze", "Jazz"]},
    {"make": "Hyundai", "models": ["Creta", "i20", "Venue", "Verna"]},
    {"make": "Toyota", "models": ["Innova", "Fortuner", "Glanza"]},
    {"make": "Tata", "models": ["Nexon", "Punch", "Harrier", "Altroz"]},
]

# (category, item_name, description, price_low_inr, price_high_inr, metadata)
INDIA_SERVICES = [
    ("brake_pads", "Front Brake Pads", "Front brake pad replacement (pair)", 1500, 3500,
     {"type": "OEM", "labor_included": True}),
    ("brake_pads", "Rear Brake Pads", "Rear brake pad replacement (pair)", 1200, 3000,
     {"type": "OEM", "labor_included": True}),
    ("brake_rotors", "Front Brake Rotors", "Front disc rotor replacement (pair)", 2500, 6000,
     {"type": "OEM", "labor_included": True}),
    ("brake_rotors", "Brake Rotor Resurfacing", "Rotor resurfacing/skimming", 500, 1200,
     {"type": "service", "labor_included": True}),
    ("oil_change", "Engine Oil Change", "Full synthetic oil change with filter", 1500, 3500,
     {"type": "synthetic", "labor_included": True}),
    ("oil_change", "Engine Oil Change (Mineral)", "Mineral oil change with filter", 800, 1800,
     {"type": "mineral", "labor_included": True}),
    ("air_filter", "Air Filter Replacement", "Engine air filter replacement", 300, 800,
     {"type": "OEM", "labor_included": True}),
    ("spark_plugs", "Spark Plug Replacement", "Set of 4 spark plugs", 800, 2500,
     {"type": "iridium", "labor_included": True}),
    ("battery", "Car Battery Replacement", "12V battery replacement with warranty", 3500, 7000,
     {"type": "branded", "labor_included": True}),
    ("ac_service", "AC Gas Recharge", "AC refrigerant recharge + leak check", 1500, 3500,
     {"type": "service", "labor_included": True}),
    ("ac_service", "AC Compressor Replacement", "AC compressor unit replacement", 8000, 18000,
     {"type": "OEM", "labor_included": True}),
    ("clutch", "Clutch Plate Replacement", "Clutch plate + pressure plate + bearing", 5000, 12000,
     {"type": "OEM", "labor_included": True}),
    ("timing_belt", "Timing Belt Replacement", "Timing belt/chain replacement", 4000, 10000,
     {"type": "OEM", "labor_included": True}),
    ("suspension", "Front Shock Absorber", "Front shock absorber replacement (pair)", 3000, 7000,
     {"type": "OEM", "labor_included": True}),
    ("suspension", "Rear Shock Absorber", "Rear shock absorber replacement (pair)", 2500, 6000,
     {"type": "OEM", "labor_included": True}),
    ("wheel_alignment", "Wheel Alignment", "4-wheel computerized alignment", 500, 1200,
     {"type": "service", "labor_included": True}),
    ("tire_rotation", "Tire Rotation + Balancing", "Rotate and balance all 4 tires", 400, 1000,
     {"type": "service", "labor_included": True}),
    ("alternator", "Alternator Replacement", "Alternator unit replacement", 4000, 9000,
     {"type": "OEM", "labor_included": True}),
    ("starter", "Starter Motor Replacement", "Starter motor replacement", 3500, 8000,
     {"type": "OEM", "labor_included": True}),
    ("coolant", "Coolant Flush", "Full cooling system flush + refill", 800, 2000,
     {"type": "service", "labor_included": True}),
    ("transmission", "Transmission Fluid Change", "ATF/gear oil change", 1500, 4000,
     {"type": "service", "labor_included": True}),
    ("exhaust", "Silencer/Muffler Replacement", "Exhaust muffler replacement", 2000, 5000,
     {"type": "aftermarket", "labor_included": True}),
    ("headlight", "Headlight Bulb Replacement", "Halogen headlight bulb (pair)", 400, 1200,
     {"type": "OEM", "labor_included": True}),
    ("wiper", "Wiper Blade Replacement", "Front wiper blades (pair)", 300, 800,
     {"type": "OEM", "labor_included": True}),
    ("power_steering", "Power Steering Fluid Change", "PS fluid flush and refill", 600, 1500,
     {"type": "service", "labor_included": True}),
]


# ---------- US DATA (prices in cents = USD * 100) ----------

US_CITIES = ["New York", "Los Angeles", "Chicago", "Houston"]

US_CITY_MULTIPLIER = {
    "New York": 1.25,       # Highest cost of living
    "Los Angeles": 1.15,    # CA premium
    "Chicago": 1.05,        # Midwest moderate
    "Houston": 1.00,        # Base / Sun Belt
}

US_MAKES = [
    {"make": "Honda", "models": ["Civic", "Accord", "CR-V"]},
    {"make": "Toyota", "models": ["Camry", "Corolla", "RAV4", "Highlander"]},
    {"make": "Ford", "models": ["F-150", "Escape", "Explorer"]},
    {"make": "Chevrolet", "models": ["Silverado", "Equinox", "Malibu"]},
    {"make": "Nissan", "models": ["Altima", "Rogue", "Sentra"]},
]

# (category, item_name, description, price_low_usd, price_high_usd, metadata)
US_SERVICES = [
    ("brake_pads", "Front Brake Pads", "Front brake pad replacement (pair)", 150, 350,
     {"type": "OEM", "labor_included": True}),
    ("brake_pads", "Rear Brake Pads", "Rear brake pad replacement (pair)", 120, 300,
     {"type": "OEM", "labor_included": True}),
    ("brake_rotors", "Front Brake Rotors", "Front disc rotor replacement (pair)", 250, 600,
     {"type": "OEM", "labor_included": True}),
    ("brake_rotors", "Brake Rotor Resurfacing", "Rotor resurfacing per rotor", 50, 120,
     {"type": "service", "labor_included": True}),
    ("oil_change", "Full Synthetic Oil Change", "Full synthetic oil change with filter", 65, 120,
     {"type": "synthetic", "labor_included": True}),
    ("oil_change", "Conventional Oil Change", "Conventional oil change with filter", 35, 75,
     {"type": "conventional", "labor_included": True}),
    ("air_filter", "Air Filter Replacement", "Engine air filter replacement", 30, 75,
     {"type": "OEM", "labor_included": True}),
    ("spark_plugs", "Spark Plug Replacement", "Set of 4 spark plugs (iridium)", 100, 250,
     {"type": "iridium", "labor_included": True}),
    ("battery", "Car Battery Replacement", "12V battery replacement with warranty", 150, 350,
     {"type": "branded", "labor_included": True}),
    ("ac_service", "AC Recharge", "AC refrigerant recharge + leak inspection", 150, 300,
     {"type": "service", "labor_included": True}),
    ("ac_service", "AC Compressor Replacement", "AC compressor unit replacement", 500, 1200,
     {"type": "OEM", "labor_included": True}),
    ("clutch", "Clutch Replacement", "Clutch kit replacement (disc + pressure plate + bearing)", 800, 1800,
     {"type": "OEM", "labor_included": True}),
    ("timing_belt", "Timing Belt Replacement", "Timing belt/chain replacement", 500, 1200,
     {"type": "OEM", "labor_included": True}),
    ("suspension", "Front Strut Replacement", "Front strut assembly replacement (pair)", 400, 900,
     {"type": "OEM", "labor_included": True}),
    ("suspension", "Rear Shock Replacement", "Rear shock absorber replacement (pair)", 300, 700,
     {"type": "OEM", "labor_included": True}),
    ("wheel_alignment", "4-Wheel Alignment", "Computerized 4-wheel alignment", 80, 150,
     {"type": "service", "labor_included": True}),
    ("tire_rotation", "Tire Rotation + Balance", "Rotate and balance all 4 tires", 40, 80,
     {"type": "service", "labor_included": True}),
    ("alternator", "Alternator Replacement", "Alternator unit replacement", 400, 800,
     {"type": "OEM", "labor_included": True}),
    ("starter", "Starter Motor Replacement", "Starter motor replacement", 350, 700,
     {"type": "OEM", "labor_included": True}),
    ("coolant", "Coolant Flush", "Full cooling system flush + refill", 100, 200,
     {"type": "service", "labor_included": True}),
    ("transmission", "Transmission Fluid Change", "ATF fluid change", 150, 350,
     {"type": "service", "labor_included": True}),
    ("exhaust", "Muffler Replacement", "Exhaust muffler replacement", 150, 400,
     {"type": "aftermarket", "labor_included": True}),
    ("headlight", "Headlight Bulb Replacement", "Halogen headlight bulb (pair)", 30, 100,
     {"type": "OEM", "labor_included": True}),
    ("wiper", "Wiper Blade Replacement", "Front wiper blades (pair)", 25, 60,
     {"type": "OEM", "labor_included": True}),
    ("power_steering", "Power Steering Fluid Flush", "PS fluid flush and refill", 80, 180,
     {"type": "service", "labor_included": True}),
]

INDIA_SOURCES = {
    "brake_pads": ("GoMechanic / MyTVS", "https://www.gomechanic.in"),
    "brake_rotors": ("GoMechanic / MyTVS", "https://www.gomechanic.in"),
    "oil_change": ("GoMechanic / MyTVS", "https://www.gomechanic.in"),
    "air_filter": ("GoMechanic", "https://www.gomechanic.in"),
    "spark_plugs": ("GoMechanic", "https://www.gomechanic.in"),
    "battery": ("Amaron / Exide dealers", "https://www.amaron.in"),
    "ac_service": ("GoMechanic / MyTVS", "https://www.gomechanic.in"),
    "clutch": ("GoMechanic", "https://www.gomechanic.in"),
    "timing_belt": ("CarDekho service", "https://www.cardekho.com"),
    "suspension": ("GoMechanic", "https://www.gomechanic.in"),
    "wheel_alignment": ("GoMechanic / local garages", "https://www.gomechanic.in"),
    "tire_rotation": ("GoMechanic / local garages", "https://www.gomechanic.in"),
    "alternator": ("CarDekho service", "https://www.cardekho.com"),
    "starter": ("CarDekho service", "https://www.cardekho.com"),
    "coolant": ("GoMechanic", "https://www.gomechanic.in"),
    "transmission": ("GoMechanic", "https://www.gomechanic.in"),
    "exhaust": ("Local garages survey", ""),
    "headlight": ("GoMechanic", "https://www.gomechanic.in"),
    "wiper": ("Amazon / Bosch", "https://www.amazon.in"),
    "power_steering": ("GoMechanic", "https://www.gomechanic.in"),
}

US_SOURCES = {
    "brake_pads": ("RepairPal", "https://repairpal.com"),
    "brake_rotors": ("RepairPal", "https://repairpal.com"),
    "oil_change": ("RepairPal / KBB", "https://repairpal.com"),
    "air_filter": ("RepairPal", "https://repairpal.com"),
    "spark_plugs": ("RepairPal", "https://repairpal.com"),
    "battery": ("AAA / AutoZone", "https://www.aaa.com"),
    "ac_service": ("RepairPal", "https://repairpal.com"),
    "clutch": ("RepairPal", "https://repairpal.com"),
    "timing_belt": ("RepairPal / KBB", "https://repairpal.com"),
    "suspension": ("RepairPal", "https://repairpal.com"),
    "wheel_alignment": ("Firestone / RepairPal", "https://repairpal.com"),
    "tire_rotation": ("Costco / Tire Rack", "https://www.tirerack.com"),
    "alternator": ("RepairPal", "https://repairpal.com"),
    "starter": ("RepairPal", "https://repairpal.com"),
    "coolant": ("RepairPal", "https://repairpal.com"),
    "transmission": ("RepairPal", "https://repairpal.com"),
    "exhaust": ("RepairPal / Meineke", "https://repairpal.com"),
    "headlight": ("AutoZone / RepairPal", "https://repairpal.com"),
    "wiper": ("AutoZone / Amazon", "https://www.autozone.com"),
    "power_steering": ("RepairPal", "https://repairpal.com"),
}


def _generate_rows(
    services: list,
    cities: list[str],
    city_multipliers: dict,
    makes: list[dict],
    country: str,
    currency: str,
    sources: dict,
    unit_multiplier: int = 100,
) -> list[dict]:
    """Generate pricing_knowledge rows for a given market."""
    rows = []
    for category, item_name, desc, price_low, price_high, meta in services:
        source_name, source_url = sources.get(category, ("", ""))
        for city in cities:
            mult = city_multipliers[city]
            low = int(price_low * mult * unit_multiplier)
            high = int(price_high * mult * unit_multiplier)

            # Generic row (not make-specific)
            rows.append({
                "id": str(uuid.uuid4()),
                "domain": "auto",
                "category": category,
                "item_name": item_name,
                "item_description": desc,
                "price_low": low,
                "price_high": high,
                "currency": currency,
                "city": city,
                "country": country,
                "source": source_name,
                "source_url": source_url,
                "confidence": 80,
                "metadata": meta,
                "created_at": datetime.now(tz=None),
                "updated_at": datetime.now(tz=None),
            })

            # Make-specific rows for popular services
            if category in ("brake_pads", "oil_change", "battery", "ac_service", "timing_belt"):
                for make_info in makes[:3]:  # Top 3 makes
                    make = make_info["make"]
                    model = make_info["models"][0]  # Most popular model
                    make_meta = {**meta, "make": make, "model": model}
                    # Slight variation by make
                    make_adj = 1.0 + (hash(make) % 10) / 100
                    rows.append({
                        "id": str(uuid.uuid4()),
                        "domain": "auto",
                        "category": category,
                        "item_name": f"{item_name} — {make} {model}",
                        "item_description": f"{desc} for {make} {model}",
                        "price_low": int(low * make_adj),
                        "price_high": int(high * make_adj),
                        "currency": currency,
                        "city": city,
                        "country": country,
                        "source": source_name,
                        "source_url": source_url,
                        "confidence": 85,
                        "metadata": make_meta,
                        "created_at": datetime.now(tz=None),
                        "updated_at": datetime.now(tz=None),
                    })

    return rows


async def seed(database_url: str):
    """Seed the database with auto repair pricing data."""
    engine = create_async_engine(database_url)
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    india_rows = _generate_rows(
        INDIA_SERVICES, INDIA_CITIES, INDIA_CITY_MULTIPLIER,
        INDIA_MAKES, "IN", "INR", INDIA_SOURCES,
    )
    us_rows = _generate_rows(
        US_SERVICES, US_CITIES, US_CITY_MULTIPLIER,
        US_MAKES, "US", "USD", US_SOURCES,
    )

    all_rows = india_rows + us_rows
    print(f"Generated {len(india_rows)} India rows + {len(us_rows)} US rows = {len(all_rows)} total")

    import json

    async with session_factory() as session:
        # Clear existing auto repair data
        await session.execute(
            text("DELETE FROM pricing_knowledge WHERE domain = 'auto'")
        )

        # Insert in batches — serialize metadata dict to JSON string for JSONB column
        batch_size = 50
        for i in range(0, len(all_rows), batch_size):
            batch = all_rows[i:i + batch_size]
            for row in batch:
                # Serialize dict to JSON string for asyncpg JSONB
                if isinstance(row.get("metadata"), dict):
                    row["metadata"] = json.dumps(row["metadata"])
                cols = list(row.keys())
                placeholders = ", ".join(f":{k}" for k in cols)
                col_names = ", ".join(cols)
                await session.execute(
                    text(f"INSERT INTO pricing_knowledge ({col_names}) VALUES ({placeholders})"),
                    row,
                )
            print(f"  Inserted batch {i // batch_size + 1}/{(len(all_rows) + batch_size - 1) // batch_size}")

        await session.commit()

    await engine.dispose()
    print(f"Seeding complete: {len(all_rows)} auto repair pricing items across India + US")


if __name__ == "__main__":
    import os
    import sys

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        # Try loading from backend .env
        env_path = os.path.join(os.path.dirname(__file__), "..", "backend", ".env")
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    if line.startswith("DATABASE_URL="):
                        db_url = line.split("=", 1)[1].strip()
                        break

    if not db_url:
        print("ERROR: Set DATABASE_URL environment variable or create backend/.env")
        sys.exit(1)

    asyncio.run(seed(db_url))
