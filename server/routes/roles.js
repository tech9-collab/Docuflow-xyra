import express from "express";
import * as rolesController from "../controllers/rolesController.js";

const router = express.Router();

// Department management routes
router.get("/departments", rolesController.getAllDepartments);
router.get("/departments/:departmentId", rolesController.getDepartmentById);
router.post("/departments", rolesController.createDepartment);
router.put("/departments/:departmentId", rolesController.updateDepartment);
router.delete("/departments/:departmentId", rolesController.deleteDepartment);
router.put(
  "/departments/:departmentId/admin-permissions",
  rolesController.updateDepartmentAdminPermissions
);

// Department-specific routes
router.get(
  "/departments/:departmentId/users",
  rolesController.getDepartmentUsers
);
router.get(
  "/departments/:departmentId/roles",
  rolesController.getDepartmentRoles
);
router.get(
  "/departments/:departmentId/document-count",
  rolesController.getDepartmentDocumentCount
);
router.get(
  "/departments/:departmentId/pending-filings",
  rolesController.getDepartmentPendingFilings
);

// User-specific routes
router.get(
  "/users/:userId/document-count",
  rolesController.getUserDocumentCount
);

// System-wide routes
router.get("/system/document-count", rolesController.getSystemDocumentCount);
router.get(
  "/system/department-document-counts",
  rolesController.getDepartmentDocumentCounts
);
router.get(
  "/system/all-users-document-counts",
  rolesController.getAllUsersDocumentCounts
);
router.get(
  "/system/aggregated-user-document-counts",
  rolesController.getAggregatedUserDocumentCounts
);
router.get("/system/monthly-summary", rolesController.getMonthlySummary);

// Monthly summary routes
router.get(
  "/users/:userId/monthly-summary",
  rolesController.getUserMonthlySummary
);
router.get(
  "/departments/:departmentId/monthly-summary",
  rolesController.getDepartmentMonthlySummary
);

// Roles routes
router.get("/roles", rolesController.getAllRoles);
router.post("/roles", rolesController.createRole);
router.put("/roles/:roleId", rolesController.updateRole);
router.delete("/roles/:roleId", rolesController.deleteRole);
router.get("/permissions", rolesController.getAllPermissions);
router.get("/roles/:roleId/permissions", rolesController.getRolePermissions);
router.put("/roles/:roleId/permissions", rolesController.updateRolePermissions);

// Employee management routes
router.get("/employees", rolesController.getAllEmployees);
router.post("/employees", rolesController.createEmployee);
router.put("/employees/:userId", rolesController.updateEmployee);
router.delete("/employees/:userId", rolesController.deleteEmployee);
router.get("/profile", rolesController.getCurrentUserProfile);

// User department permissions
router.get(
  "/users/:userId/department-permissions",
  rolesController.getUserDepartmentPermissions
);

export default router;
