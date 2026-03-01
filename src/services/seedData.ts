import { db } from './database';

const firstNames = [
  'Emma', 'Liam', 'Olivia', 'Noah', 'Ava', 'Ethan', 'Sophia', 'Mason', 'Isabella', 'William',
  'Mia', 'James', 'Charlotte', 'Benjamin', 'Amelia', 'Lucas', 'Harper', 'Henry', 'Evelyn', 'Alexander',
  'Abigail', 'Michael', 'Emily', 'Daniel', 'Elizabeth', 'Jacob', 'Sofia', 'Logan', 'Avery', 'Jackson',
  'Ella', 'Sebastian', 'Scarlett', 'Jack', 'Grace', 'Aiden', 'Chloe', 'Owen', 'Victoria', 'Samuel',
  'Riley', 'Matthew', 'Aria', 'Joseph', 'Lily', 'Levi', 'Aubrey', 'David', 'Zoey', 'John'
];

const lastNames = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
  'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
  'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
  'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts'
];

const grades = [
  'Kindergarten', '1st Grade', '2nd Grade', '3rd Grade', '4th Grade', '5th Grade',
  '6th Grade', '7th Grade', '8th Grade'
];

function generatePhoneNumber(): string {
  const areaCode = Math.floor(Math.random() * 900) + 100;
  const firstPart = Math.floor(Math.random() * 900) + 100;
  const lastPart = Math.floor(Math.random() * 9000) + 1000;
  return `(${areaCode}) ${firstPart}-${lastPart}`;
}

function generateEmail(firstName: string, lastName: string): string {
  const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'];
  const domain = domains[Math.floor(Math.random() * domains.length)];
  return `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`;
}

function generatePickupCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function getRandomItem<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

export async function seedMockKids(count: number = 50): Promise<void> {
  console.log(`Starting to seed ${count} mock kids...`);
  
  try {
    await db.initialize();
    
    const usedCodes = new Set<string>();
    let successCount = 0;
    
    for (let i = 0; i < count; i++) {
      const kidFirstName = getRandomItem(firstNames);
      const kidLastName = getRandomItem(lastNames);
      const kidName = `${kidFirstName} ${kidLastName}`;
      
      // Parent is often different name
      const parentFirstName = getRandomItem(firstNames);
      const parentLastName = kidLastName; // Usually same last name
      const parentName = `${parentFirstName} ${parentLastName}`;
      
      // Generate unique pickup code
      let pickupCode: string;
      do {
        pickupCode = generatePickupCode();
      } while (usedCodes.has(pickupCode));
      usedCodes.add(pickupCode);
      
      const kid = {
        name: kidName,
        grade: getRandomItem(grades),
        parent_name: parentName,
        parent_phone: generatePhoneNumber(),
        parent_email: generateEmail(parentFirstName, parentLastName),
        pickup_code: pickupCode
      };
      
      try {
        await db.addKid(kid);
        successCount++;
        console.log(`✓ Added kid ${successCount}/${count}: ${kidName} (Code: ${pickupCode})`);
      } catch (error) {
        console.error(`✗ Failed to add kid ${i + 1}: ${kidName}`, error);
      }
    }
    
    console.log(`\n✅ Successfully seeded ${successCount} out of ${count} kids!`);
  } catch (error) {
    console.error('Error seeding data:', error);
    throw error;
  }
}

// Function to clear all kids (use with caution!)
export async function clearAllKids(): Promise<void> {
  try {
    await db.initialize();
    const kids = await db.getKids();
    
    for (const kid of kids) {
      await db.deleteKid(kid.id!);
    }
    
    console.log(`✅ Cleared ${kids.length} kids from database`);
  } catch (error) {
    console.error('Error clearing kids:', error);
    throw error;
  }
}
