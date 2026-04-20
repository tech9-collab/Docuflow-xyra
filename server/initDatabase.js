// initDatabase.js
import { pool } from "./db.js";

export async function initializeDatabase() {
  try {
    console.log("Initializing database schema...");

    // Consistent charset/engine
    await pool.query(`SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await pool.query(`SET FOREIGN_KEY_CHECKS = 0`);

    // 1) departments (parent for roles, users, user_departments)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        company_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (company_id),
        CONSTRAINT fk_departments_company
          FOREIGN KEY (company_id) REFERENCES companies(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 2) roles (parent for users, role_permissions)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        description TEXT,
        department_id INT NULL,
        company_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (department_id),
        INDEX (company_id),
        CONSTRAINT fk_roles_department
          FOREIGN KEY (department_id) REFERENCES departments(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_roles_company
          FOREIGN KEY (company_id) REFERENCES companies(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // make sure composite unique exists, and old global-unique is gone
    //     await pool.query(`SET @have := (SELECT COUNT(1) FROM information_schema.statistics
    //   WHERE table_schema = DATABASE() AND table_name='roles' AND index_name='uniq_role_name_dept')`);
    //     await pool.query(`
    //   DO
    //   CASE WHEN @have = 0 THEN
    //     (SELECT 1 FROM (SELECT 1) x)
    //   ELSE (SELECT 1)
    //   END
    // `); // no-op to allow multi statements
    //     await pool.query(`
    //   -- drop any unique index on 'name' alone (if still present)
    //   SET @idx := (
    //     SELECT index_name FROM information_schema.statistics
    //     WHERE table_schema = DATABASE() AND table_name='roles'
    //       AND non_unique = 0 AND column_name='name' AND index_name <> 'PRIMARY'
    //     LIMIT 1
    //   );
    // `);
    // await pool.query(`SET @sql := IF(@idx IS NOT NULL, CONCAT('ALTER TABLE roles DROP INDEX ', @idx), NULL)`);
    // await pool.query(`PREPARE stmt FROM @sql`);
    // await pool.query(`EXECUTE stmt`);
    // await pool.query(`DEALLOCATE PREPARE stmt`);
    // await pool.query(`ALTER TABLE roles ADD UNIQUE KEY IF NOT EXISTS uniq_role_name_dept (name, department_id)`);

    // 3) permissions (parent for role_permissions)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS permissions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) UNIQUE NOT NULL,
        description TEXT,
        module VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 4) role_permissions (child of roles & permissions)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_id INT NOT NULL,
        permission_id INT NOT NULL,
        PRIMARY KEY (role_id, permission_id),
        INDEX (role_id),
        INDEX (permission_id),
        CONSTRAINT fk_role_permissions_role
          FOREIGN KEY (role_id) REFERENCES roles(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_role_permissions_permission
          FOREIGN KEY (permission_id) REFERENCES permissions(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 5) users (child of roles & departments)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        country_code VARCHAR(10),
        role_id INT NULL,
        department_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (role_id),
        INDEX (department_id),
        CONSTRAINT fk_users_role
          FOREIGN KEY (role_id) REFERENCES roles(id)
          ON DELETE SET NULL,
        CONSTRAINT fk_users_department
          FOREIGN KEY (department_id) REFERENCES departments(id)
          ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Ensure users.status exists (controllers read u.status)
    const [statusCol] = await pool.query(
      "SHOW COLUMNS FROM users LIKE 'status'"
    );
    if (!statusCol.length) {
      await pool.query(`
                ALTER TABLE users
                ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active' AFTER country_code
            `);
    }

    // Ensure users.business_name exists
    const [businessNameCol] = await pool.query(
      "SHOW COLUMNS FROM users LIKE 'business_name'"
    );
    if (!businessNameCol.length) {
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN business_name VARCHAR(255) NOT NULL DEFAULT '' AFTER status
      `);
    }

    // Ensure users.type exists
    const [typeCol] = await pool.query(
      "SHOW COLUMNS FROM users LIKE 'type'"
    );
    if (!typeCol.length) {
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN type VARCHAR(50) NOT NULL DEFAULT 'super_admin' AFTER business_name
      `);
    }

    // Ensure users.created_by exists
    const [createdByCol] = await pool.query(
      "SHOW COLUMNS FROM users LIKE 'created_by'"
    );
    if (!createdByCol.length) {
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN created_by INT NULL AFTER type,
        ADD INDEX (created_by)
      `);
    }

    // Ensure users.company_name exists
    const [compNameCol] = await pool.query(
      "SHOW COLUMNS FROM users LIKE 'company_name'"
    );
    if (!compNameCol.length) {
      await pool.query(`
        ALTER TABLE users
        ADD COLUMN company_name VARCHAR(255) AFTER status
      `);
    }
    // Ensure departments.business_name exists
    const [deptBizCol] = await pool.query(
      "SHOW COLUMNS FROM departments LIKE 'business_name'"
    );
    if (!deptBizCol.length) {
      await pool.query(`
        ALTER TABLE departments
        ADD COLUMN business_name VARCHAR(255) NOT NULL DEFAULT ''
      `);
    }

    // Ensure roles.business_name exists
    const [roleBizCol] = await pool.query(
      "SHOW COLUMNS FROM roles LIKE 'business_name'"
    );
    if (!roleBizCol.length) {
      await pool.query(`
        ALTER TABLE roles
        ADD COLUMN business_name VARCHAR(255) NOT NULL DEFAULT ''
      `);
    }

    // 6) user_departments (child of users & departments)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_departments (
        user_id INT NOT NULL,
        department_id INT NOT NULL,
        role_name VARCHAR(50),
        PRIMARY KEY (user_id, department_id),
        INDEX (user_id),
        INDEX (department_id),
        CONSTRAINT fk_user_departments_user
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE,
        CONSTRAINT fk_user_departments_department
          FOREIGN KEY (department_id) REFERENCES departments(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 6.5) companies
    await pool.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id INT AUTO_INCREMENT PRIMARY KEY,
        business_name VARCHAR(255) NOT NULL,
        business_id VARCHAR(100) NULL,
        type VARCHAR(50) DEFAULT 'admin',
        description TEXT,
        user_id INT NULL,
        department_id INT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (user_id),
        INDEX (department_id),
        CONSTRAINT fk_companies_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_companies_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Migrate: rename name -> business_name if old column still exists
    const [oldNameCol] = await pool.query("SHOW COLUMNS FROM companies LIKE 'name'");
    if (oldNameCol.length) {
      await pool.query("ALTER TABLE companies CHANGE COLUMN name business_name VARCHAR(255) NOT NULL DEFAULT ''");
    }

    // Ensure business_name column exists
    const [busNameCol] = await pool.query("SHOW COLUMNS FROM companies LIKE 'business_name'");
    if (!busNameCol.length) {
      await pool.query("ALTER TABLE companies ADD COLUMN business_name VARCHAR(255) NOT NULL DEFAULT '' AFTER id");
    }

    // Add business_id column if missing
    const [busIdCol] = await pool.query("SHOW COLUMNS FROM companies LIKE 'business_id'");
    if (!busIdCol.length) {
      await pool.query("ALTER TABLE companies ADD COLUMN business_id VARCHAR(100) NULL AFTER business_name");
    }

    // Migrate type column from ENUM to VARCHAR(50) so it can store 'admin'
    const [compTypeCol] = await pool.query("SHOW COLUMNS FROM companies LIKE 'type'");
    if (compTypeCol.length && compTypeCol[0].Type.startsWith('enum')) {
      await pool.query("ALTER TABLE companies MODIFY COLUMN type VARCHAR(50) DEFAULT 'admin'");
    } else if (!compTypeCol.length) {
      await pool.query("ALTER TABLE companies ADD COLUMN type VARCHAR(50) DEFAULT 'admin' AFTER business_id");
    }

    const [compDescCol] = await pool.query("SHOW COLUMNS FROM companies LIKE 'description'");
    if (!compDescCol.length) {
      await pool.query("ALTER TABLE companies ADD COLUMN description TEXT AFTER type");
    }

    const [compUserIdCol] = await pool.query("SHOW COLUMNS FROM companies LIKE 'user_id'");
    if (!compUserIdCol.length) {
      await pool.query("ALTER TABLE companies ADD COLUMN user_id INT NULL AFTER description, ADD INDEX (user_id)");
    }

    const [compDeptIdCol] = await pool.query("SHOW COLUMNS FROM companies LIKE 'department_id'");
    if (!compDeptIdCol.length) {
      await pool.query("ALTER TABLE companies ADD COLUMN department_id INT NULL AFTER user_id, ADD INDEX (department_id)");
    }

    // Auth fields for company admin accounts (registered via /auth/register)
    const [compEmailCol] = await pool.query("SHOW COLUMNS FROM companies LIKE 'email'");
    if (!compEmailCol.length) {
      await pool.query("ALTER TABLE companies ADD COLUMN email VARCHAR(255) NULL UNIQUE AFTER department_id");
    }
    const [compPasswordCol] = await pool.query("SHOW COLUMNS FROM companies LIKE 'password'");
    if (!compPasswordCol.length) {
      await pool.query("ALTER TABLE companies ADD COLUMN password VARCHAR(255) NULL AFTER email");
    }
    const [compContactCol] = await pool.query("SHOW COLUMNS FROM companies LIKE 'contact_name'");
    if (!compContactCol.length) {
      await pool.query("ALTER TABLE companies ADD COLUMN contact_name VARCHAR(255) NULL AFTER password");
    }
    const [compPhoneCol] = await pool.query("SHOW COLUMNS FROM companies LIKE 'phone'");
    if (!compPhoneCol.length) {
      await pool.query("ALTER TABLE companies ADD COLUMN phone VARCHAR(20) NULL AFTER contact_name");
    }
    const [compCountryCol] = await pool.query("SHOW COLUMNS FROM companies LIKE 'country_code'");
    if (!compCountryCol.length) {
      await pool.query("ALTER TABLE companies ADD COLUMN country_code VARCHAR(10) NULL AFTER phone");
    }

    // 6.6) Add business_id to users if not present, or migrate INT → VARCHAR(100)
    const [userCompIdCol] = await pool.query("SHOW COLUMNS FROM users LIKE 'business_id'");
    if (!userCompIdCol.length) {
      // Fresh install: create as VARCHAR(100) directly
      await pool.query("ALTER TABLE users ADD COLUMN business_id VARCHAR(100) NULL AFTER department_id, ADD INDEX (business_id)");
    } else if (userCompIdCol[0].Type.startsWith('int')) {
      // Migration: business_id is currently INT (storing companies.id), convert to VARCHAR(100) storing 'BIZ-XXXXX'
      console.log('Migrating users.business_id from INT to VARCHAR(100)...');
      // 1) Drop FK constraint if it exists
      try {
        await pool.query("ALTER TABLE users DROP FOREIGN KEY fk_users_company");
      } catch (e) { /* FK may not exist */ }
      try {
        await pool.query("ALTER TABLE users DROP INDEX business_id");
      } catch (e) { /* Index may not exist or have different name */ }
      // 2) Add a temp column to hold the string business_id
      await pool.query("ALTER TABLE users ADD COLUMN business_id_new VARCHAR(100) NULL AFTER business_id");
      // 3) Populate temp column by looking up companies.business_id using the numeric value
      await pool.query(`
        UPDATE users u
        LEFT JOIN companies c ON u.business_id = c.id
        SET u.business_id_new = c.business_id
        WHERE u.business_id IS NOT NULL
      `);
      // 4) Drop old column, rename new column
      await pool.query("ALTER TABLE users DROP COLUMN business_id");
      await pool.query("ALTER TABLE users CHANGE COLUMN business_id_new business_id VARCHAR(100) NULL, ADD INDEX (business_id)");
      console.log('Migration complete: users.business_id is now VARCHAR(100)');
    }

    // 6.7) Add company_id to departments if not present
    const [deptCompIdCol] = await pool.query("SHOW COLUMNS FROM departments LIKE 'company_id'");
    if (!deptCompIdCol.length) {
      await pool.query("ALTER TABLE departments ADD COLUMN company_id INT NULL AFTER name, ADD INDEX (company_id)");
      await pool.query("ALTER TABLE departments ADD CONSTRAINT fk_departments_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL");
    }

    // 6.8) Add company_id to roles if not present
    const [roleCompIdCol] = await pool.query("SHOW COLUMNS FROM roles LIKE 'company_id'");
    if (!roleCompIdCol.length) {
      await pool.query("ALTER TABLE roles ADD COLUMN company_id INT NULL AFTER department_id, ADD INDEX (company_id)");
      await pool.query("ALTER TABLE roles ADD CONSTRAINT fk_roles_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL");
    }

    // 11) customers (master customer record used by VAT / CT / other modules)
    await pool.query(`
  CREATE TABLE IF NOT EXISTS customers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    department_id INT NULL,

    -- Basic details
    customer_name VARCHAR(255) NOT NULL,
    address TEXT,
    email VARCHAR(255),
    mobile VARCHAR(50),
    country VARCHAR(100),

    -- Business / entity details
    entity_type VARCHAR(100),
    entity_sub_type VARCHAR(100),
    date_of_incorporation DATE,
    trade_license_authority VARCHAR(255),
    trade_license_number VARCHAR(100),
    license_issue_date DATE,
    license_expiry_date DATE,
    business_activity TEXT,
    is_freezone TINYINT(1) DEFAULT 0,
    freezone_name VARCHAR(255),

    authorised_signatories VARCHAR(255),
    share_capital VARCHAR(100),
    fta_credentials VARCHAR(255),
    fta_password VARCHAR(255),

    -- Tax & financials
    functional_currency VARCHAR(10),

    -- VAT info
    vat_tax_treatment VARCHAR(50),
    vat_info_certificate_path VARCHAR(512),
    vat_trn VARCHAR(50),
    vat_registered_date DATE,
    first_vat_filing_period VARCHAR(100),
    vat_return_due_date DATE,
    vat_reporting_period ENUM('monthly','quarterly') NULL,
    place_of_supply VARCHAR(100),

    -- Corporate tax info
    ct_tax_treatment VARCHAR(50),
    ct_trn VARCHAR(50),
    ct_registered_date DATE,
    corporate_tax_period VARCHAR(100),
    first_ct_period_start_date DATE,
    first_ct_period_end_date DATE,
    first_ct_return_due_date DATE,
    ct_certificate_tax_path VARCHAR(512),

    status ENUM('active','inactive') DEFAULT 'active',

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX (user_id),
    INDEX (department_id),
    company_id INT NULL,
    INDEX (company_id),
    CONSTRAINT fk_customers_user
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_customers_department
      FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
    CONSTRAINT fk_customers_company
      FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

    // 12) customer_shareholders (owner / shareholding rows)
    await pool.query(`
  CREATE TABLE IF NOT EXISTS customer_shareholders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    owner_type VARCHAR(50),
    name VARCHAR(255),
    nationality VARCHAR(100),
    share_percentage DECIMAL(5,2),

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX (customer_id),
    CONSTRAINT fk_customer_shareholders_customer
      FOREIGN KEY (customer_id) REFERENCES customers(id)
      ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

    // 13) customer_documents (business docs like MOA, TL, VAT cert etc.)
    await pool.query(`
  CREATE TABLE IF NOT EXISTS customer_documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    customer_id INT NOT NULL,
    doc_type VARCHAR(50),             -- moa, trade_license, vat_certificate, ct_certificate, other, etc.
    file_path VARCHAR(512) NOT NULL,  -- relative to UPLOADS_ROOT
    original_name VARCHAR(255),
    mime_type VARCHAR(100),

    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    INDEX (customer_id),
    INDEX (doc_type),
    CONSTRAINT fk_customer_documents_customer
      FOREIGN KEY (customer_id) REFERENCES customers(id)
      ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

    // 14) vat_filing_periods (link customer + filing periods)
    await pool.query(`
  CREATE TABLE IF NOT EXISTS vat_filing_periods (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    customer_id INT NOT NULL,
    period_from DATE NOT NULL,
    period_to DATE NOT NULL,
    due_date DATE NULL,
    submit_date DATE NULL,
    status ENUM('not_started','in_progress','submitted','overdue') DEFAULT 'not_started',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX (user_id),
    INDEX (customer_id),
    CONSTRAINT fk_vfp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_vfp_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

    await pool.query(`
  CREATE TABLE IF NOT EXISTS ct_filing_periods (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    customer_id INT NOT NULL,
    period_from DATE NOT NULL,
    period_to DATE NOT NULL,
    -- CT due & submission dates
    due_date DATE NULL,
    submit_date DATE NULL,
    status ENUM('not_started','in_progress','submitted','overdue')
      DEFAULT 'not_started',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ON UPDATE CURRENT_TIMESTAMP,
    INDEX (user_id),
    INDEX (customer_id),
    CONSTRAINT fk_ctfp_user
      FOREIGN KEY (user_id) REFERENCES users(id)
      ON DELETE CASCADE,
    CONSTRAINT fk_ctfp_customer
      FOREIGN KEY (customer_id) REFERENCES customers(id)
      ON DELETE CASCADE
  ) ENGINE=InnoDB
    DEFAULT CHARSET=utf8mb4
    COLLATE=utf8mb4_unicode_ci
`);

    // 7) modules (for tracking document types)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS modules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        module_name VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 8) document_count (for tracking user document uploads)
    // First create the table with original schema
    await pool.query(`
      CREATE TABLE IF NOT EXISTS document_count (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        files_count INT DEFAULT 0,
        file_size BIGINT DEFAULT 0,
        file_uploaded_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX (user_id),
        CONSTRAINT fk_document_count_user
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // 9) invoice_converts (local store for each converted invoice doc)
    await pool.query(`
  CREATE TABLE IF NOT EXISTS invoice_converts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    department_id INT NOT NULL,
    module_id INT NULL,

    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT DEFAULT 0,

    file_input_path  VARCHAR(512) NOT NULL,   -- relative to UPLOADS_ROOT
    file_output_json_path VARCHAR(512) NULL,  -- relative to UPLOADS_ROOT

    status ENUM('uploaded','queued','extracting','extracted','failed')
      DEFAULT 'uploaded',
    error_text TEXT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX(user_id), INDEX(department_id), INDEX(module_id), INDEX(status),

    CONSTRAINT fk_ic_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_ic_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
    CONSTRAINT fk_ic_module FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

    await pool.query(`
CREATE TABLE IF NOT EXISTS vat_filing_runs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  customer_id INT NOT NULL,
  vat_period_id INT NOT NULL,
  status ENUM('draft','final') DEFAULT 'draft',
  company_name VARCHAR(255),
  company_trn VARCHAR(50),
  combined_json_path VARCHAR(512) NOT NULL,  -- uploads/vat_filing/json/...
  combined_excel_path VARCHAR(512) NULL,     -- uploads/vat_filing/excel/... (optional)
  notes TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ON UPDATE CURRENT_TIMESTAMP,
  INDEX(user_id),
  INDEX(customer_id),
  INDEX(vat_period_id),
  CONSTRAINT fk_vfr_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_vfr_customer
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
  CONSTRAINT fk_vfr_period
    FOREIGN KEY (vat_period_id) REFERENCES vat_filing_periods(id) ON DELETE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARSET=utf8mb4
  COLLATE=utf8mb4_unicode_ci;
`);

    // 9b) bank_statements_converts (local store for each converted bank doc)
    await pool.query(`
  CREATE TABLE IF NOT EXISTS bank_statements_converts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    department_id INT NOT NULL,
    module_id INT NULL,

    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT DEFAULT 0,

    file_input_path  VARCHAR(512) NOT NULL,   -- relative to UPLOADS_ROOT
    file_output_json_path VARCHAR(512) NULL,  -- relative to UPLOADS_ROOT

    status ENUM('uploaded','queued','extracting','extracted','failed')
      DEFAULT 'uploaded',
    error_text TEXT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX(user_id), INDEX(department_id), INDEX(module_id), INDEX(status),

    CONSTRAINT fk_bsc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_bsc_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
    CONSTRAINT fk_bsc_module FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

    // Emirates Id Converter Table
    await pool.query(`
  CREATE TABLE IF NOT EXISTS emirates_converts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    department_id INT NOT NULL,
    module_id INT NULL,

    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT DEFAULT 0,

    file_input_path  VARCHAR(512) NOT NULL,   -- relative to UPLOADS_ROOT
    file_output_json_path VARCHAR(512) NULL,  -- relative to UPLOADS_ROOT

    status ENUM('uploaded','queued','extracting','extracted','failed')
      DEFAULT 'uploaded',
    error_text TEXT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX(user_id), INDEX(department_id), INDEX(module_id), INDEX(status),

    CONSTRAINT fk_ec_user   FOREIGN KEY (user_id)      REFERENCES users(id)       ON DELETE CASCADE,
    CONSTRAINT fk_ec_dept   FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
    CONSTRAINT fk_ec_module FOREIGN KEY (module_id)     REFERENCES modules(id)     ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

    // Passport Converter Table
    await pool.query(`
  CREATE TABLE IF NOT EXISTS passport_converts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    department_id INT NOT NULL,
    module_id INT NULL,

    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT DEFAULT 0,

    file_input_path  VARCHAR(512) NOT NULL,   -- relative to UPLOADS_ROOT
    file_output_json_path VARCHAR(512) NULL,  -- relative to UPLOADS_ROOT

    status ENUM('uploaded','queued','extracting','extracted','failed')
      DEFAULT 'uploaded',
    error_text TEXT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX(user_id), INDEX(department_id), INDEX(module_id), INDEX(status),

    CONSTRAINT fk_pc_user   FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_pc_dept   FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
    CONSTRAINT fk_pc_module FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

    // Visa Converter Table
    await pool.query(`
  CREATE TABLE IF NOT EXISTS visa_converts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    department_id INT NOT NULL,
    module_id INT NULL,

    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT DEFAULT 0,

    file_input_path VARCHAR(512) NOT NULL,      -- relative to UPLOADS_ROOT
    file_output_json_path VARCHAR(512) NULL,    -- relative to UPLOADS_ROOT

    status ENUM('uploaded','queued','extracting','extracted','failed')
      DEFAULT 'uploaded',
    error_text TEXT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX(user_id), INDEX(department_id), INDEX(module_id), INDEX(status),

    CONSTRAINT fk_vc_user   FOREIGN KEY (user_id)       REFERENCES users(id)       ON DELETE CASCADE,
    CONSTRAINT fk_vc_dept   FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
    CONSTRAINT fk_vc_module FOREIGN KEY (module_id)     REFERENCES modules(id)     ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

    // Trade License Converter Table
    await pool.query(`
  CREATE TABLE IF NOT EXISTS trade_license_converts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    department_id INT NOT NULL,
    module_id INT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_size BIGINT DEFAULT 0,
    file_input_path VARCHAR(512) NOT NULL,
    file_output_json_path VARCHAR(512) NULL,
    status ENUM('uploaded','queued','extracting','extracted','failed') DEFAULT 'uploaded',
    error_text TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX(user_id), INDEX(department_id), INDEX(module_id), INDEX(status),
    CONSTRAINT fk_tlc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_tlc_dept FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
    CONSTRAINT fk_tlc_module FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`);

    // Now add the new columns if they don't exist
    // Check and add module_id column
    const [moduleIdCol] = await pool.query(
      "SHOW COLUMNS FROM document_count LIKE 'module_id'"
    );
    if (!moduleIdCol.length) {
      await pool.query(`
                ALTER TABLE document_count
                ADD COLUMN module_id INT NULL,
                ADD CONSTRAINT fk_document_count_module
                  FOREIGN KEY (module_id) REFERENCES modules(id)
                  ON DELETE SET NULL
            `);
    }

    // Check and add file_name column
    const [fileNameCol] = await pool.query(
      "SHOW COLUMNS FROM document_count LIKE 'file_name'"
    );
    if (!fileNameCol.length) {
      await pool.query(`
                ALTER TABLE document_count
                ADD COLUMN file_name VARCHAR(255) NULL
            `);
    }

    // Check and add page_count column
    const [pageCountCol] = await pool.query(
      "SHOW COLUMNS FROM document_count LIKE 'page_count'"
    );
    if (!pageCountCol.length) {
      await pool.query(`
                ALTER TABLE document_count
                ADD COLUMN page_count INT DEFAULT 0
            `);
    }

    // Check and add input_tokens column
    const [inputTokensCol] = await pool.query(
      "SHOW COLUMNS FROM document_count LIKE 'input_tokens'"
    );
    if (!inputTokensCol.length) {
      await pool.query(`
                ALTER TABLE document_count
                ADD COLUMN input_tokens INT DEFAULT 0
            `);
    }

    // Check and add output_tokens column
    const [outputTokensCol] = await pool.query(
      "SHOW COLUMNS FROM document_count LIKE 'output_tokens'"
    );
    if (!outputTokensCol.length) {
      await pool.query(`
                ALTER TABLE document_count
                ADD COLUMN output_tokens INT DEFAULT 0
            `);
    }

    // Insert default permissions if they don't exist
    const defaultPermissions = [
      // System permissions
      {
        name: "dashboard.read",
        description: "Access dashboard",
        module: "system",
      },

      // Role & Permission Management
      { name: "roles.read", description: "View roles", module: "roles" },
      { name: "roles.create", description: "Create roles", module: "roles" },
      { name: "roles.update", description: "Edit roles", module: "roles" },
      { name: "roles.delete", description: "Delete roles", module: "roles" },

      // Customer Management
      {
        name: "customers.read",
        description: "View customers",
        module: "customers",
      },
      {
        name: "customers.create",
        description: "Create customers",
        module: "customers",
      },
      {
        name: "customers.update",
        description: "Edit customers",
        module: "customers",
      },
      {
        name: "customers.delete",
        description: "Delete customers",
        module: "customers",
      },

      // User Management
      { name: "employees.read", description: "View users", module: "users" },
      {
        name: "employees.create",
        description: "Create users",
        module: "users",
      },
      { name: "employees.update", description: "Edit users", module: "users" },
      {
        name: "employees.delete",
        description: "Delete users",
        module: "users",
      },

      // Department Management
      {
        name: "projects.vat_filing",
        description: "Access VAT Filing",
        module: "projects",
      },
      {
        name: "projects.ct_filing",
        description: "Access CT Filing",
        module: "projects",
      },

      // Company Management
      {
        name: "companies.read",
        description: "View companies",
        module: "companies",
      },
      {
        name: "companies.create",
        description: "Create companies",
        module: "companies",
      },
      {
        name: "companies.update",
        description: "Edit companies",
        module: "companies",
      },
      {
        name: "companies.delete",
        description: "Delete companies",
        module: "companies",
      },

      // Document Convert Permissions
      {
        name: "converts.bank_statements",
        description: "Process bank statements",
        module: "converts",
      },
      {
        name: "converts.invoices",
        description: "Process invoices",
        module: "converts",
      },
      {
        name: "converts.bills",
        description: "Process bills",
        module: "converts",
      },
      {
        name: "converts.emirates_id",
        description: "Process Emirates ID",
        module: "converts",
      },
      {
        name: "converts.passport",
        description: "Process passport",
        module: "converts",
      },
      {
        name: "converts.visa",
        description: "Process visa",
        module: "converts",
      },
      {
        name: "converts.trade_license",
        description: "Process trade license",
        module: "converts",
      },
    ];

    for (const perm of defaultPermissions) {
      const [existing] = await pool.query(
        "SELECT id FROM permissions WHERE name = ? LIMIT 1",
        [perm.name]
      );

      if (!existing.length) {
        await pool.query(
          "INSERT INTO permissions (name, description, module) VALUES (?, ?, ?)",
          [perm.name, perm.description, perm.module]
        );
      }
    }

    // Ensure every company has the full default department set
    try {
      const defaultDepts = ['Audit', 'Bookkeeping', 'Accounts', 'Corporate Tax', 'Default', 'Invoice'];
      const [companies] = await pool.query("SELECT id FROM companies");
      for (const company of companies) {
        const [existing] = await pool.query(
          "SELECT name FROM departments WHERE company_id = ?",
          [company.id]
        );
        const existingNames = new Set(existing.map((dept) => dept.name));

        for (const deptName of defaultDepts) {
          if (!existingNames.has(deptName)) {
            await pool.query(
              "INSERT INTO departments (name, company_id) VALUES (?, ?)",
              [deptName, company.id]
            );
          }
        }
      }
    } catch (e) { console.warn("Default departments migration skipped:", e.message); }

    // Make user_id nullable in vat_filing_periods (admin users have no users-table row)
    try {
      const [vfpUserCol] = await pool.query("SHOW COLUMNS FROM vat_filing_periods LIKE 'user_id'");
      if (vfpUserCol.length && vfpUserCol[0].Null === 'NO') {
        await pool.query("SET FOREIGN_KEY_CHECKS = 0");
        await pool.query("ALTER TABLE vat_filing_periods MODIFY COLUMN user_id INT NULL");
        await pool.query("SET FOREIGN_KEY_CHECKS = 1");
      }
    } catch (e) { console.warn("vat_filing_periods user_id migration skipped:", e.message); }

    // Make user_id nullable in vat_filing_runs (admin users may not have users-table rows)
    try {
      const [vfrUserCol] = await pool.query("SHOW COLUMNS FROM vat_filing_runs LIKE 'user_id'");
      if (vfrUserCol.length && vfrUserCol[0].Null === 'NO') {
        await pool.query("SET FOREIGN_KEY_CHECKS = 0");
        await pool.query("ALTER TABLE vat_filing_runs MODIFY COLUMN user_id INT NULL");
        await pool.query("SET FOREIGN_KEY_CHECKS = 1");
      }
    } catch (e) { console.warn("vat_filing_runs user_id migration skipped:", e.message); }

    // Make user_id nullable in ct_filing_periods
    try {
      const [ctfpUserCol] = await pool.query("SHOW COLUMNS FROM ct_filing_periods LIKE 'user_id'");
      if (ctfpUserCol.length && ctfpUserCol[0].Null === 'NO') {
        await pool.query("SET FOREIGN_KEY_CHECKS = 0");
        await pool.query("ALTER TABLE ct_filing_periods MODIFY COLUMN user_id INT NULL");
        await pool.query("SET FOREIGN_KEY_CHECKS = 1");
      }
    } catch (e) { console.warn("ct_filing_periods user_id migration skipped:", e.message); }

    await pool.query(`SET FOREIGN_KEY_CHECKS = 1`);
    console.log("Database schema initialized successfully");
  } catch (error) {
    console.error("Error initializing database:", error);
    throw error;
  }
}

// --- Helper exports (needed by your middleware) ---

export async function getUserRole(userId) {
  try {
    const [rows] = await pool.query(
      `
      SELECT r.id as role_role_id, r.name, r.description, r.department_id, u.type, u.role_id
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      WHERE u.id = ?
      `,
      [userId]
    );

    if (!rows.length) return null;

    const userRow = rows[0];

    // Only force 'super_admin' role NAME if user type is specifically 'super_admin'
    if (userRow.type === 'super_admin') {
      return {
        id: userRow.id || 0,
        name: 'super_admin',
        description: 'Super administrator with full system access',
        department_id: userRow.department_id
      };
    }

    return userRow;
  } catch (err) {
    console.error("getUserRole error:", err);
    return null;
  }
}

export async function getUserPermissions(userId) {
  try {
    const [rows] = await pool.query(
      `
      SELECT DISTINCT p.name, p.description, p.module
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN role_permissions rp ON r.id = rp.role_id
      LEFT JOIN permissions p ON rp.permission_id = p.id
      WHERE u.id = ? AND p.name IS NOT NULL
      `,
      [userId]
    );
    return rows || [];
  } catch (err) {
    console.error("getUserPermissions error:", err);
    return [];
  }
}

export async function checkUserPermission(userId, permissionName) {
  try {
    // First check if user is super_admin by type or role_id
    const [userData] = await pool.query("SELECT type, role_id FROM users WHERE id = ?", [userId]);
    if (userData.length && (userData[0].type === 'super_admin' || userData[0].role_id === 1)) {
      return true; // Super admins have all permissions
    }

    const [rows] = await pool.query(
      `
      SELECT 1
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.id
      LEFT JOIN role_permissions rp ON r.id = rp.role_id
      LEFT JOIN permissions p ON rp.permission_id = p.id
      WHERE u.id = ? AND p.name = ?
      LIMIT 1
      `,
      [userId, permissionName]
    );
    return rows.length > 0;
  } catch (err) {
    console.error("checkUserPermission error:", err);
    return false;
  }
}

// Helper function to get module ID by name
export async function getModuleIdByName(moduleName) {
  try {
    const [rows] = await pool.query(
      `SELECT id FROM modules WHERE module_name = ? LIMIT 1`,
      [moduleName]
    );
    return rows.length > 0 ? rows[0].id : null;
  } catch (err) {
    console.error("getModuleIdByName error:", err);
    return null;
  }
}

// Helper function to update document count for a user with module information
// Each document gets its own entry in the document_count table
export async function updateDocumentCount(
  userId,
  filesCount,
  fileSize,
  moduleName,
  fileName = null,
  pageCount = 0,
  inputTokens = 0,
  outputTokens = 0
) {
  try {
    // Get module ID
    const moduleId = await getModuleIdByName(moduleName);

    // Get today's date
    const today = new Date();
    const fileUploadedDate = `${today.getFullYear()}-${String(
      today.getMonth() + 1
    ).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    // Create new entry for each document processed (no aggregation)
    await pool.query(
      `INSERT INTO document_count (user_id, module_id, files_count, file_size, file_name, page_count, file_uploaded_date, input_tokens, output_tokens)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        moduleId,
        filesCount,
        fileSize,
        fileName,
        pageCount,
        fileUploadedDate,
        inputTokens || 0,
        outputTokens || 0,
      ]
    );
  } catch (err) {
    console.error("updateDocumentCount error:", err);
  }
}

// Helper function to get document count for a user with module information
export async function getDocumentCount(userId, days = 30) {
  try {
    const [rows] = await pool.query(
      `SELECT dc.id, dc.files_count, dc.file_size, dc.file_uploaded_date, dc.file_name, dc.page_count, m.module_name
             FROM document_count dc
             LEFT JOIN modules m ON dc.module_id = m.id
             WHERE dc.user_id = ? 
             AND dc.file_uploaded_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
             ORDER BY dc.id DESC`,
      [userId, days]
    );
    return rows;
  } catch (err) {
    console.error("getDocumentCount error:", err);
    return [];
  }
}

export async function getUserDepartmentId(userId) {
  const [r] = await pool.query(
    "SELECT department_id FROM users WHERE id=? LIMIT 1",
    [userId]
  );
  return r.length ? r[0].department_id : null;
}

export async function getOrCreateDefaultDepartmentId() {
  const [r] = await pool.query(
    "SELECT id FROM departments WHERE name='Default' LIMIT 1"
  );
  if (r.length) return r[0].id;
  const [ins] = await pool.query(
    "INSERT INTO departments (name, description) VALUES ('Default','Auto-created')"
  );
  return ins.insertId;
}

// Invoice Storage Helpers
export async function ensureModuleId(moduleName) {
  const [rows] = await pool.query(
    `SELECT id FROM modules WHERE module_name=? LIMIT 1`,
    [moduleName]
  );
  if (rows.length) return rows[0].id;
  const [ins] = await pool.query(
    `INSERT INTO modules (module_name) VALUES (?)`,
    [moduleName]
  );
  return ins.insertId;
}

export async function createInvoiceConvert({
  userId,
  departmentId,
  moduleId,
  fileName,
  fileSize,
  fileInputPath,
}) {
  const [r] = await pool.query(
    `INSERT INTO invoice_converts
     (user_id, department_id, module_id, file_name, file_size, file_input_path, status)
     VALUES (?, ?, ?, ?, ?, ?, 'queued')`,
    [userId, departmentId, moduleId, fileName, fileSize || 0, fileInputPath]
  );
  return r.insertId;
}

export async function setInvoiceConvertStatus(id, status, errorText = null) {
  await pool.query(
    `UPDATE invoice_converts SET status=?, error_text=?, updated_at=NOW() WHERE id=?`,
    [status, errorText, id]
  );
}

export async function setInvoiceConvertOutputJsonPath(
  id,
  jsonPath,
  status = "extracted"
) {
  await pool.query(
    `UPDATE invoice_converts SET file_output_json_path=?, status=?, updated_at=NOW() WHERE id=?`,
    [jsonPath, status, id]
  );
}

// Bank Statement Storage Helpers
export async function createBankConvert({
  userId,
  departmentId,
  moduleId,
  fileName,
  fileSize,
  fileInputPath,
}) {
  const [r] = await pool.query(
    `INSERT INTO bank_statements_converts
     (user_id, department_id, module_id, file_name, file_size, file_input_path, status)
     VALUES (?, ?, ?, ?, ?, ?, 'queued')`,
    [userId, departmentId, moduleId, fileName, fileSize || 0, fileInputPath]
  );
  return r.insertId;
}

export async function setBankConvertStatus(id, status, errorText = null) {
  await pool.query(
    `UPDATE bank_statements_converts SET status=?, error_text=?, updated_at=NOW() WHERE id=?`,
    [status, errorText, id]
  );
}

export async function setBankConvertOutputJsonPath(
  id,
  jsonPath,
  status = "extracted"
) {
  await pool.query(
    `UPDATE bank_statements_converts SET file_output_json_path=?, status=?, updated_at=NOW() WHERE id=?`,
    [jsonPath, status, id]
  );
}

// Emirates Storage Helpers
export async function createEmiratesConvert({
  userId,
  departmentId,
  moduleId,
  fileName,
  fileSize,
  fileInputPath,
}) {
  const [r] = await pool.query(
    `INSERT INTO emirates_converts
     (user_id, department_id, module_id, file_name, file_size, file_input_path, status)
     VALUES (?, ?, ?, ?, ?, ?, 'queued')`,
    [userId, departmentId, moduleId, fileName, fileSize || 0, fileInputPath]
  );
  return r.insertId;
}

export async function setEmiratesConvertStatus(id, status, errorText = null) {
  await pool.query(
    `UPDATE emirates_converts SET status=?, error_text=?, updated_at=NOW() WHERE id=?`,
    [status, errorText, id]
  );
}

export async function setEmiratesConvertOutputJsonPath(
  id,
  jsonPath,
  status = "extracted"
) {
  await pool.query(
    `UPDATE emirates_converts SET file_output_json_path=?, status=?, updated_at=NOW() WHERE id=?`,
    [jsonPath, status, id]
  );
}

// Passport Storage Helpers
export async function createPassportConvert({
  userId,
  departmentId,
  moduleId,
  fileName,
  fileSize,
  fileInputPath,
}) {
  const [r] = await pool.query(
    `INSERT INTO passport_converts
     (user_id, department_id, module_id, file_name, file_size, file_input_path, status)
     VALUES (?, ?, ?, ?, ?, ?, 'queued')`,
    [userId, departmentId, moduleId, fileName, fileSize || 0, fileInputPath]
  );
  return r.insertId;
}

export async function setPassportConvertStatus(id, status, errorText = null) {
  await pool.query(
    `UPDATE passport_converts SET status=?, error_text=?, updated_at=NOW() WHERE id=?`,
    [status, errorText, id]
  );
}

export async function setPassportConvertOutputJsonPath(
  id,
  jsonPath,
  status = "extracted"
) {
  await pool.query(
    `UPDATE passport_converts SET file_output_json_path=?, status=?, updated_at=NOW() WHERE id=?`,
    [jsonPath, status, id]
  );
}

// Visa Storage Helpers
export async function createVisaConvert({
  userId,
  departmentId,
  moduleId,
  fileName,
  fileSize,
  fileInputPath,
}) {
  const [r] = await pool.query(
    `INSERT INTO visa_converts
     (user_id, department_id, module_id, file_name, file_size, file_input_path, status)
     VALUES (?, ?, ?, ?, ?, ?, 'queued')`,
    [userId, departmentId, moduleId, fileName, fileSize || 0, fileInputPath]
  );
  return r.insertId;
}

export async function setVisaConvertStatus(id, status, errorText = null) {
  await pool.query(
    `UPDATE visa_converts
       SET status = ?, error_text = ?, updated_at = NOW()
     WHERE id = ?`,
    [status, errorText, id]
  );
}

export async function setVisaConvertOutputJsonPath(
  id,
  jsonPath,
  status = "extracted"
) {
  await pool.query(
    `UPDATE visa_converts
       SET file_output_json_path = ?, status = ?, updated_at = NOW()
     WHERE id = ?`,
    [jsonPath, status, id]
  );
}

// Trade License Storage helpers:
export async function createTradeLicenseConvert({
  userId,
  departmentId,
  moduleId,
  fileName,
  fileSize,
  fileInputPath,
}) {
  const [r] = await pool.query(
    `INSERT INTO trade_license_converts
     (user_id, department_id, module_id, file_name, file_size, file_input_path, status)
     VALUES (?, ?, ?, ?, ?, ?, 'queued')`,
    [userId, departmentId, moduleId, fileName, fileSize || 0, fileInputPath]
  );
  return r.insertId;
}

export async function setTradeLicenseConvertStatus(id, status, err = null) {
  await pool.query(
    `UPDATE trade_license_converts SET status=?, error_text=?, updated_at=NOW() WHERE id=?`,
    [status, err, id]
  );
}

export async function setTradeLicenseConvertOutputJsonPath(
  id,
  jsonPath,
  status = "extracted"
) {
  await pool.query(
    `UPDATE trade_license_converts SET file_output_json_path=?, status=?, updated_at=NOW() WHERE id=?`,
    [jsonPath, status, id]
  );
}

export { pool };
